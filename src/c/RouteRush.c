/*
 * CTATrack — CTA train & bus arrivals for Pebble Time 2
 *
 * GPS location is obtained via the companion JS (phone GPS or device GPS).
 * Train arrivals: CTA Train Tracker API (transitchicago.com/developers)
 * Bus arrivals  : CTA Bus Tracker API + Chicago Open Data Portal for nearby stops
 *
 * Buttons:
 *   UP / DOWN : cycle through nearby results
 *   SELECT    : toggle between Train and Bus mode (triggers a new fetch)
 *   BACK      : exit (handled by Pebble OS)
 */

#include <pebble.h>

/* ── AppMessage keys (must match package.json messageKeys) ─────────────────── */
#define KEY_MSG_TYPE      0
#define KEY_STATION_NAME  1
#define KEY_ARRIVALS      2
#define KEY_LINE_COLOR    3
#define KEY_STATION_IDX   4
#define KEY_TOTAL_STNS    5
#define KEY_ERROR_MSG     6
#define KEY_STATION_META  7
#define KEY_THEME         8

/* MsgType values  C→JS */
#define MSG_REQ_TRAIN  0
#define MSG_REQ_BUS    1
/* MsgType values  JS→C */
#define MSG_STATION    2
#define MSG_ERROR      3
#define MSG_THEME      4

/* Theme values JS->C */
#define THEME_DARK   0
#define THEME_LIGHT  1
#define THEME_AUTO   2

/* Persisted app state keys */
#define PERSIST_KEY_THEME_MODE 100

/* CTA line color codes (sent from JS) */
#define LINE_RED    0
#define LINE_BLUE   1
#define LINE_BROWN  2
#define LINE_GREEN  3
#define LINE_ORANGE 4
#define LINE_PINK   5
#define LINE_PURPLE 6
#define LINE_YELLOW 7
#define LINE_BUS    8

/* Storage */
#define MAX_STATIONS  16
#define MAX_NAME_LEN  48
#define MAX_META_LEN  32
#define MAX_ARRV_LEN 128

typedef struct {
  char name[MAX_NAME_LEN];
  char meta[MAX_META_LEN];
  char arrivals[MAX_ARRV_LEN];
  int  line;
} StationData;

/* ── CTA line display names ─────────────────────────────────────────────────── */
static const char * const LINE_NAMES[] = {
  "RED LINE", "BLUE LINE", "BROWN LINE", "GREEN LINE",
  "ORANGE LINE", "PINK LINE", "PURPLE LINE", "YELLOW LINE", "BUS"
};

/* ── State ──────────────────────────────────────────────────────────────────── */
static int         s_mode    = 0;      /* 0 = train, 1 = bus */
static int         s_idx     = 0;
static int         s_total   = 0;
static bool        s_loading = true;
static bool        s_compact_ui = false;
static bool        s_round_ui = false;
static int         s_theme_mode = THEME_AUTO;
static StationData s_stations[MAX_STATIONS];

/* ── Layers ─────────────────────────────────────────────────────────────────── */
static Window          *s_window;
static StatusBarLayer  *s_status_bar;
static Layer           *s_color_bar;
static TextLayer       *s_line_label;    /* left: "RED LINE" / "BUS" */
static TextLayer       *s_counter_label; /* right: "2/5" */
static TextLayer       *s_station_name;
static TextLayer       *s_station_meta;
static TextLayer       *s_arrivals;
static TextLayer       *s_nav_hints;

/* Theme-derived colors for body/nav layers */
static GColor s_bg_color;
static GColor s_primary_text_color;
static GColor s_secondary_text_color;
static GColor s_nav_bg_color;
static GColor s_nav_text_color;

static int theme_from_local_time(void) {
  time_t now = time(NULL);
  struct tm *local_time;
  local_time = localtime(&now);
  if (!local_time) return THEME_DARK;
  return (local_time->tm_hour >= 8 && local_time->tm_hour < 20) ? THEME_LIGHT : THEME_DARK;
}

static int resolved_theme_mode(void) {
  if (s_theme_mode == THEME_LIGHT || s_theme_mode == THEME_DARK) return s_theme_mode;
  return theme_from_local_time();
}

static bool ui_ready(void) {
  return s_window && s_nav_hints && s_station_name && s_station_meta && s_arrivals && s_status_bar;
}

static void apply_theme_colors(void) {
  bool light = (resolved_theme_mode() == THEME_LIGHT);
  s_bg_color             = light ? GColorWhite : GColorBlack;
  s_primary_text_color   = light ? GColorBlack : GColorWhite;
  s_secondary_text_color = light ? GColorDarkGray : GColorLightGray;
  s_nav_bg_color         = light ? GColorLightGray : GColorDarkGray;
  s_nav_text_color       = light ? GColorBlack : GColorWhite;

  if (!ui_ready()) return;

  window_set_background_color(s_window, s_bg_color);
  status_bar_layer_set_colors(s_status_bar, s_bg_color, s_primary_text_color);
  text_layer_set_text_color(s_station_name, s_primary_text_color);
  text_layer_set_text_color(s_station_meta, s_secondary_text_color);
  text_layer_set_text_color(s_arrivals, s_primary_text_color);
  text_layer_set_background_color(s_nav_hints, s_nav_bg_color);
  text_layer_set_text_color(s_nav_hints, s_nav_text_color);
}

/* ── Refresh timer ──────────────────────────────────────────────────────────── */
static AppTimer *s_refresh_timer = NULL;
#define REFRESH_MS (60 * 1000)

/* ── Colour helpers ─────────────────────────────────────────────────────────── */

static GColor get_line_color(int line) {
#ifdef PBL_COLOR
  switch (line) {
    case LINE_RED:    return GColorFromRGB(198,  12,  48);  /* #C60C30 */
    case LINE_BLUE:   return GColorFromRGB(  0, 161, 222);  /* #00A1DE */
    case LINE_BROWN:  return GColorFromRGB( 98,  54,  27);  /* #62361B */
    case LINE_GREEN:  return GColorFromRGB(  0, 155,  58);  /* #009B3A */
    case LINE_ORANGE: return GColorFromRGB(249,  70,  28);  /* #F9461C */
    case LINE_PINK:   return GColorFromRGB(226, 126, 166);  /* #E27EA6 */
    case LINE_PURPLE: return GColorFromRGB( 82,  35, 152);  /* #522398 */
    case LINE_YELLOW: return GColorFromRGB(249, 227,   0);  /* #F9E300 */
    case LINE_BUS:    return GColorFromRGB(  0, 102,  51);  /* dark green */
    default:          return GColorLightGray;
  }
#else
  (void)line;
  return GColorBlack;
#endif
}

static GColor get_text_on_line(int line) {
#ifdef PBL_COLOR
  return (line == LINE_YELLOW) ? GColorBlack : GColorWhite;
#else
  (void)line;
  return GColorWhite;
#endif
}

/* ── Colour-bar draw proc ───────────────────────────────────────────────────── */

static int s_current_line = LINE_RED;

static void color_bar_update_proc(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  graphics_context_set_fill_color(ctx, get_line_color(s_current_line));
  graphics_fill_rect(ctx, b, s_round_ui ? 10 : 0, s_round_ui ? GCornersAll : GCornerNone);
}

/* ── Display refresh ────────────────────────────────────────────────────────── */

/* Sets the colour bar to the current mode's default line and updates label colours. */
static void apply_mode_bar(void) {
  s_current_line = (s_mode == 1) ? LINE_BUS : LINE_RED;
  GColor txt = get_text_on_line(s_current_line);
  text_layer_set_text_color(s_line_label,    txt);
  text_layer_set_text_color(s_counter_label, txt);
  text_layer_set_text(s_line_label, s_mode == 0 ? "TRAIN" : "BUS");
  layer_mark_dirty(s_color_bar);
}

static void update_display(void) {
  static char nav_hint_buf[64];
  apply_theme_colors();
  if (s_round_ui || s_compact_ui) {
    snprintf(nav_hint_buf, sizeof(nav_hint_buf), "^v next  SEL %s",
             s_mode == 0 ? "BUS" : "TRAIN");
  } else {
    snprintf(nav_hint_buf, sizeof(nav_hint_buf), "^v : next %s | SEL: %s",
             s_mode == 0 ? "stop" : "station", s_mode == 0 ? "BUS" : "TRAIN");
  }

  if (s_loading) {
    apply_mode_bar();
    text_layer_set_text(s_counter_label, "...");
    text_layer_set_text(s_station_name,  "Locating...");
    text_layer_set_text(s_station_meta,  "Searching nearby");
    text_layer_set_text(s_arrivals,      "Contacting CTA");
    text_layer_set_text(s_nav_hints,     nav_hint_buf);
    return;
  }

  if (s_total == 0) {
    apply_mode_bar();
    text_layer_set_text(s_counter_label, "0");
    text_layer_set_text(s_station_name,  "No results");
    text_layer_set_text(s_station_meta,  "");
    text_layer_set_text(s_arrivals,      "None found nearby");
    text_layer_set_text(s_nav_hints,     nav_hint_buf);
    return;
  }

  StationData *st = &s_stations[s_idx];
  s_current_line = st->line;
  GColor txt_color = get_text_on_line(s_current_line);

  text_layer_set_text_color(s_line_label,    txt_color);
  text_layer_set_text_color(s_counter_label, txt_color);

  /* Show specific line/route name once we have real data */
  if (st->line >= 0 && st->line <= LINE_BUS) {
    text_layer_set_text(s_line_label, LINE_NAMES[st->line]);
  } else {
    text_layer_set_text(s_line_label, s_mode == 0 ? "TRAIN" : "BUS");
  }

  static char counter_buf[24];
  snprintf(counter_buf, sizeof(counter_buf), "%d/%d", s_idx + 1, s_total);
  text_layer_set_text(s_counter_label, counter_buf);

  text_layer_set_text(s_station_name, st->name);
  text_layer_set_text(s_station_meta, st->meta);
  text_layer_set_text(s_arrivals, st->arrivals[0] ? st->arrivals : "No arrivals");

  text_layer_set_text(s_nav_hints, nav_hint_buf);

  layer_mark_dirty(s_color_bar);
}

/* ── AppMessage send ────────────────────────────────────────────────────────── */

static AppTimer *s_send_retry_timer = NULL;

static void send_request(void);  /* forward decl */

static void send_retry_cb(void *ctx) {
  (void)ctx;
  s_send_retry_timer = NULL;
  send_request();  /* keep retrying until outbox is free */
}

static void outbox_failed_cb(DictionaryIterator *iter, AppMessageResult reason, void *ctx) {
  (void)iter; (void)ctx;
  APP_LOG(APP_LOG_LEVEL_ERROR, "Outbox failed: %d", (int)reason);
  if (!s_send_retry_timer) {
    s_send_retry_timer = app_timer_register(300, send_retry_cb, NULL);
  }
}

static void send_request(void) {
  if (s_send_retry_timer) {
    app_timer_cancel(s_send_retry_timer);
    s_send_retry_timer = NULL;
  }
  DictionaryIterator *iter;
  AppMessageResult res = app_message_outbox_begin(&iter);
  if (res == APP_MSG_BUSY) {
    s_send_retry_timer = app_timer_register(200, send_retry_cb, NULL);
    return;
  }
  if (res != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Outbox begin failed: %d", (int)res);
    return;
  }
  uint8_t req = (s_mode == 0) ? MSG_REQ_TRAIN : MSG_REQ_BUS;
  dict_write_uint8(iter, KEY_MSG_TYPE, req);
  AppMessageResult send_res = app_message_outbox_send();
  if (send_res != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Outbox send failed: %d", (int)send_res);
    if (!s_send_retry_timer) {
      s_send_retry_timer = app_timer_register(300, send_retry_cb, NULL);
    }
  }
}

/* ── AppMessage receive ─────────────────────────────────────────────────────── */

static int safe_int(Tuple *t) {
  if (!t) return 0;
  switch (t->length) {
    case 1:  return (int)t->value->int8;
    case 2:  return (int)t->value->int16;
    default: return (int)t->value->int32;
  }
}

static void inbox_received_cb(DictionaryIterator *iter, void *ctx) {
  (void)ctx;
  Tuple *type_t = dict_find(iter, KEY_MSG_TYPE);
  if (!type_t) return;
  int msg_type = safe_int(type_t);

  if (msg_type == MSG_STATION) {
    Tuple *name_t  = dict_find(iter, KEY_STATION_NAME);
    Tuple *arrv_t  = dict_find(iter, KEY_ARRIVALS);
    Tuple *line_t  = dict_find(iter, KEY_LINE_COLOR);
    Tuple *idx_t   = dict_find(iter, KEY_STATION_IDX);
    Tuple *total_t = dict_find(iter, KEY_TOTAL_STNS);
    Tuple *meta_t  = dict_find(iter, KEY_STATION_META);

    if (!name_t || !arrv_t || !line_t || !idx_t || !total_t) return;

    int idx   = safe_int(idx_t);
    int total = safe_int(total_t);
    if (idx < 0 || idx >= MAX_STATIONS) return;
    if (total > MAX_STATIONS) total = MAX_STATIONS;

    StationData *st = &s_stations[idx];
    strncpy(st->name, name_t->value->cstring, MAX_NAME_LEN - 1);
    st->name[MAX_NAME_LEN - 1] = '\0';
    if (meta_t && meta_t->type == TUPLE_CSTRING) {
      strncpy(st->meta, meta_t->value->cstring, MAX_META_LEN - 1);
      st->meta[MAX_META_LEN - 1] = '\0';
    } else {
      st->meta[0] = '\0';
    }
    strncpy(st->arrivals, arrv_t->value->cstring, MAX_ARRV_LEN - 1);
    st->arrivals[MAX_ARRV_LEN - 1] = '\0';
    st->line = safe_int(line_t);

    s_total   = total;
    s_loading = false;
    update_display();

  } else if (msg_type == MSG_THEME) {
    Tuple *theme_t = dict_find(iter, KEY_THEME);
    int theme = safe_int(theme_t);
    if (theme == THEME_LIGHT || theme == THEME_DARK || theme == THEME_AUTO) {
      s_theme_mode = theme;
    } else {
      s_theme_mode = THEME_AUTO;
    }
    persist_write_int(PERSIST_KEY_THEME_MODE, s_theme_mode);
    update_display();

  } else if (msg_type == MSG_ERROR) {
    Tuple *err_t = dict_find(iter, KEY_ERROR_MSG);
    s_loading = false;
    s_total   = 0;
    text_layer_set_text(s_station_name, "Error");
    text_layer_set_text(s_station_meta, "");
    text_layer_set_text(s_arrivals, err_t ? err_t->value->cstring : "Unknown error");
    layer_mark_dirty(s_color_bar);
  }
}

static void inbox_dropped_cb(AppMessageResult reason, void *ctx) {
  (void)ctx;
  APP_LOG(APP_LOG_LEVEL_WARNING, "AppMessage dropped: %d", (int)reason);
}

/* ── Refresh timer ──────────────────────────────────────────────────────────── */

static void refresh_cb(void *ctx) {
  (void)ctx;
  s_loading = true;
  s_total   = 0;
  s_idx     = 0;
  update_display();
  send_request();
  s_refresh_timer = app_timer_register(REFRESH_MS, refresh_cb, NULL);
}

/* ── Button handlers ────────────────────────────────────────────────────────── */

static void up_click_cb(ClickRecognizerRef rec, void *ctx) {
  (void)rec; (void)ctx;
  if (s_total < 2) return;
  s_idx = (s_idx - 1 + s_total) % s_total;
  update_display();
}

static void down_click_cb(ClickRecognizerRef rec, void *ctx) {
  (void)rec; (void)ctx;
  if (s_total < 2) return;
  s_idx = (s_idx + 1) % s_total;
  update_display();
}

static void select_click_cb(ClickRecognizerRef rec, void *ctx) {
  (void)rec; (void)ctx;
  s_mode    = 1 - s_mode;
  s_loading = true;
  s_total   = 0;
  s_idx     = 0;
  update_display();
  send_request();
}

static void click_config_provider(void *ctx) {
  (void)ctx;
  window_single_click_subscribe(BUTTON_ID_UP,     up_click_cb);
  window_single_click_subscribe(BUTTON_ID_DOWN,   down_click_cb);
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click_cb);
}

/* ── Window load / unload ───────────────────────────────────────────────────── */

static void window_load(Window *window) {
  Layer  *root   = window_get_root_layer(window);
  GRect   bounds = layer_get_bounds(root);
  int16_t W  = bounds.size.w;
  int16_t H  = bounds.size.h;
  int16_t SB = STATUS_BAR_LAYER_HEIGHT; /* 16 on rect, 0 on chalk */
#if defined(PBL_ROUND)
  s_round_ui = true;
  int16_t side_pad   = (W >= 200) ? 28 : 22;
  int16_t top_pad    = (W >= 200) ? 14 : 10;
  int16_t bottom_pad = (W >= 200) ? 20 : 14;
#else
  s_round_ui = false;
  int16_t side_pad   = 6;
  int16_t top_pad    = 0;
  int16_t bottom_pad = 0;
#endif
  int16_t content_x = side_pad;
  int16_t content_w = W - (side_pad * 2);
  int16_t header_inset = s_round_ui ? 18 : 0;
  int16_t body_inset   = s_round_ui ? 10 : 0;
  int16_t header_x     = content_x + header_inset;
  int16_t header_w     = content_w - (header_inset * 2);
  int16_t body_x       = content_x + body_inset;
  int16_t body_w       = content_w - (body_inset * 2);

  /* Compact mode for 144x168 class displays; larger screens keep roomy spacing. */
  s_compact_ui = (H < 200);
  int16_t CB     = s_compact_ui ? 24 : (s_round_ui ? 32 : 38);  /* colour-bar height */
  int16_t name_h = s_compact_ui ? 20 : (s_round_ui ? 58 : 46);  /* station name height */
  int16_t meta_h = s_compact_ui ? 14 : 18;
  int16_t nav_h  = s_compact_ui ? 14 : (s_round_ui ? 12 : 16);
  int16_t gap    = s_compact_ui ? 2 : (s_round_ui ? 6 : 4);
  int16_t counter_w = s_round_ui ? 42 : (s_compact_ui ? 28 : 42);
  int16_t counter_margin = s_round_ui ? 48 : (s_compact_ui ? 34 : 48);

  apply_theme_colors();

  /* Status bar — shows current time on the right */
  s_status_bar = status_bar_layer_create();
  status_bar_layer_set_colors(s_status_bar, GColorBlack, GColorWhite);
  status_bar_layer_set_separator_mode(s_status_bar, StatusBarLayerSeparatorModeNone);
  layer_add_child(root, status_bar_layer_get_layer(s_status_bar));

  /* CTA line colour bar */
  s_color_bar = layer_create(GRect(header_x, SB + top_pad, header_w, CB));
  layer_set_update_proc(s_color_bar, color_bar_update_proc);
  layer_add_child(root, s_color_bar);

  /* Line name — left-aligned in colour bar */
  s_line_label = text_layer_create(GRect(header_x + 10, SB + top_pad, header_w - counter_margin - 10, CB));
  text_layer_set_background_color(s_line_label, GColorClear);
  text_layer_set_text_color(s_line_label, GColorWhite);
  text_layer_set_font(s_line_label, fonts_get_system_font(s_compact_ui ? FONT_KEY_GOTHIC_14_BOLD : (s_round_ui ? FONT_KEY_GOTHIC_24_BOLD : FONT_KEY_GOTHIC_18_BOLD)));
  text_layer_set_text_alignment(s_line_label, GTextAlignmentLeft);
  layer_add_child(root, text_layer_get_layer(s_line_label));

  /* Station counter — right-aligned in colour bar ("2/5") */
  s_counter_label = text_layer_create(GRect(header_x + header_w - counter_margin, SB + top_pad, counter_w, CB));
  text_layer_set_background_color(s_counter_label, GColorClear);
  text_layer_set_text_color(s_counter_label, GColorWhite);
  text_layer_set_font(s_counter_label, fonts_get_system_font(s_compact_ui ? FONT_KEY_GOTHIC_14 : FONT_KEY_GOTHIC_18_BOLD));
  text_layer_set_text_alignment(s_counter_label, GTextAlignmentRight);
  layer_add_child(root, text_layer_get_layer(s_counter_label));

  /* Station / stop name */
  int16_t name_y = SB + top_pad + CB + gap;
  s_station_name = text_layer_create(GRect(body_x, name_y, body_w, name_h));
  text_layer_set_background_color(s_station_name, GColorClear);
  text_layer_set_text_color(s_station_name, GColorWhite);
  text_layer_set_font(s_station_name, fonts_get_system_font(s_compact_ui ? FONT_KEY_GOTHIC_14_BOLD : (s_round_ui ? FONT_KEY_GOTHIC_24_BOLD : FONT_KEY_GOTHIC_24_BOLD)));
  text_layer_set_overflow_mode(s_station_name, (s_compact_ui && !s_round_ui) ? GTextOverflowModeTrailingEllipsis : GTextOverflowModeWordWrap);
  text_layer_set_text_alignment(s_station_name, GTextAlignmentLeft);
  layer_add_child(root, text_layer_get_layer(s_station_name));

  /* Distance and relative direction */
  int16_t meta_y = name_y + name_h + gap;
  s_station_meta = text_layer_create(GRect(body_x, meta_y, body_w, meta_h));
  text_layer_set_background_color(s_station_meta, GColorClear);
  text_layer_set_text_color(s_station_meta, GColorLightGray);
  text_layer_set_font(s_station_meta, fonts_get_system_font(s_compact_ui ? FONT_KEY_GOTHIC_14 : FONT_KEY_GOTHIC_18));
  text_layer_set_text_alignment(s_station_meta, GTextAlignmentLeft);
  layer_add_child(root, text_layer_get_layer(s_station_meta));

  /* Arrivals (fills remaining space above nav bar) */
  int16_t arrv_y = meta_y + meta_h + gap;
  int16_t arrv_h = (H - bottom_pad) - arrv_y - nav_h;
  s_arrivals = text_layer_create(GRect(body_x, arrv_y, body_w, arrv_h));
  text_layer_set_background_color(s_arrivals, GColorClear);
  text_layer_set_text_color(s_arrivals, GColorWhite);
  text_layer_set_font(s_arrivals, fonts_get_system_font(s_compact_ui ? FONT_KEY_GOTHIC_14_BOLD : FONT_KEY_GOTHIC_18_BOLD));
  text_layer_set_overflow_mode(s_arrivals, GTextOverflowModeWordWrap);
  text_layer_set_text_alignment(s_arrivals, GTextAlignmentLeft);
  layer_add_child(root, text_layer_get_layer(s_arrivals));

  /* Nav hints bar */
  s_nav_hints = text_layer_create(GRect(body_x, H - bottom_pad - nav_h, body_w, nav_h));
  text_layer_set_background_color(s_nav_hints, s_round_ui ? GColorClear : GColorDarkGray);
  text_layer_set_text_color(s_nav_hints, s_round_ui ? s_secondary_text_color : GColorWhite);
  text_layer_set_font(s_nav_hints, fonts_get_system_font((s_compact_ui || s_round_ui) ? FONT_KEY_GOTHIC_09 : FONT_KEY_GOTHIC_14));
  text_layer_set_text_alignment(s_nav_hints, GTextAlignmentCenter);
  layer_add_child(root, text_layer_get_layer(s_nav_hints));

  apply_theme_colors();

  update_display();
}

static void window_unload(Window *window) {
  (void)window;
  text_layer_destroy(s_nav_hints);
  text_layer_destroy(s_arrivals);
  text_layer_destroy(s_station_meta);
  text_layer_destroy(s_station_name);
  text_layer_destroy(s_counter_label);
  text_layer_destroy(s_line_label);
  layer_destroy(s_color_bar);
  status_bar_layer_destroy(s_status_bar);
}

/* ── App init / deinit ──────────────────────────────────────────────────────── */

static void prv_init(void) {
  if (persist_exists(PERSIST_KEY_THEME_MODE)) {
    int persisted_theme_mode = persist_read_int(PERSIST_KEY_THEME_MODE);
    if (persisted_theme_mode == THEME_LIGHT || persisted_theme_mode == THEME_DARK || persisted_theme_mode == THEME_AUTO) {
      s_theme_mode = persisted_theme_mode;
    }
  }

  app_message_open(1024, 256);
  app_message_register_inbox_received(inbox_received_cb);
  app_message_register_inbox_dropped(inbox_dropped_cb);
  app_message_register_outbox_failed(outbox_failed_cb);

  s_window = window_create();
  window_set_click_config_provider(s_window, click_config_provider);
  window_set_window_handlers(s_window, (WindowHandlers){
    .load   = window_load,
    .unload = window_unload,
  });
  window_stack_push(s_window, true);

  send_request();
  s_refresh_timer = app_timer_register(REFRESH_MS, refresh_cb, NULL);
}

static void prv_deinit(void) {
  if (s_refresh_timer) app_timer_cancel(s_refresh_timer);
  if (s_send_retry_timer) app_timer_cancel(s_send_retry_timer);
  window_destroy(s_window);
}

int main(void) {
  prv_init();
  app_event_loop();
  prv_deinit();
}
