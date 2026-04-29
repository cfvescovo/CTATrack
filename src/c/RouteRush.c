/*
 * CTATrack — CTA train & bus arrivals for Pebble Time 2
 *
 * GPS location is obtained via the companion JS (phone GPS or device GPS).
 * Train arrivals: CTA Train Tracker API (transitchicago.com/developers)
 * Bus arrivals  : CTA Bus Tracker API + Chicago Open Data Portal for nearby stops
 *
 * Buttons:
 *   UP / DOWN : cycle through up to 5 nearby stations or bus stops
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

/* MsgType values  C→JS */
#define MSG_REQ_TRAIN  0
#define MSG_REQ_BUS    1
/* MsgType values  JS→C */
#define MSG_STATION    2
#define MSG_ERROR      3

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
#define MAX_STATIONS   5
#define MAX_NAME_LEN  48
#define MAX_ARRV_LEN 128

typedef struct {
  char name[MAX_NAME_LEN];
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
static StationData s_stations[MAX_STATIONS];

/* ── Layers ─────────────────────────────────────────────────────────────────── */
static Window          *s_window;
static StatusBarLayer  *s_status_bar;
static Layer           *s_color_bar;
static TextLayer       *s_line_label;    /* left: "RED LINE" / "BUS" */
static TextLayer       *s_counter_label; /* right: "2/5" */
static TextLayer       *s_station_name;
static TextLayer       *s_arrivals;
static TextLayer       *s_nav_hints;

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
  graphics_fill_rect(ctx, b, 0, GCornerNone);
}

/* ── Display refresh ────────────────────────────────────────────────────────── */

static void update_display(void) {
  GColor txt_color;

  if (s_loading) {
    s_current_line = (s_mode == 1) ? LINE_BUS : LINE_RED;
    txt_color = get_text_on_line(s_current_line);
    text_layer_set_text_color(s_line_label,    txt_color);
    text_layer_set_text_color(s_counter_label, txt_color);
    text_layer_set_text(s_line_label,    s_mode == 0 ? "TRAIN" : "BUS");
    text_layer_set_text(s_counter_label, "...");
    text_layer_set_text(s_station_name,  "Locating...");
    text_layer_set_text(s_arrivals,      "Contacting CTA");
    text_layer_set_text(s_nav_hints,     "SELECT: switch mode");
    layer_mark_dirty(s_color_bar);
    return;
  }

  if (s_total == 0) {
    s_current_line = (s_mode == 1) ? LINE_BUS : LINE_RED;
    txt_color = get_text_on_line(s_current_line);
    text_layer_set_text_color(s_line_label,    txt_color);
    text_layer_set_text_color(s_counter_label, txt_color);
    text_layer_set_text(s_line_label,    s_mode == 0 ? "TRAIN" : "BUS");
    text_layer_set_text(s_counter_label, "0");
    text_layer_set_text(s_station_name,  "No results");
    text_layer_set_text(s_arrivals,      "None found nearby");
    text_layer_set_text(s_nav_hints,     "SELECT: switch mode");
    layer_mark_dirty(s_color_bar);
    return;
  }

  StationData *st = &s_stations[s_idx];
  s_current_line = st->line;
  txt_color = get_text_on_line(s_current_line);

  text_layer_set_text_color(s_line_label,    txt_color);
  text_layer_set_text_color(s_counter_label, txt_color);

  /* Show specific line/route name once we have real data */
  if (st->line >= 0 && st->line <= LINE_BUS) {
    text_layer_set_text(s_line_label, LINE_NAMES[st->line]);
  } else {
    text_layer_set_text(s_line_label, s_mode == 0 ? "TRAIN" : "BUS");
  }

  static char counter_buf[6];
  counter_buf[0] = '0' + (char)(s_idx + 1);
  counter_buf[1] = '/';
  counter_buf[2] = '0' + (char)s_total;
  counter_buf[3] = '\0';
  text_layer_set_text(s_counter_label, counter_buf);

  text_layer_set_text(s_station_name, st->name);
  text_layer_set_text(s_arrivals, st->arrivals[0] ? st->arrivals : "No arrivals");

  static char nav_buf[32];
  snprintf(nav_buf, sizeof(nav_buf), "^ v  navigate  |  SEL: switch");
  text_layer_set_text(s_nav_hints, nav_buf);

  layer_mark_dirty(s_color_bar);
}

/* ── AppMessage send ────────────────────────────────────────────────────────── */

static void send_request(void) {
  DictionaryIterator *iter;
  AppMessageResult res = app_message_outbox_begin(&iter);
  if (res != APP_MSG_OK) return;

  uint8_t req = (s_mode == 0) ? MSG_REQ_TRAIN : MSG_REQ_BUS;
  dict_write_uint8(iter, KEY_MSG_TYPE, req);
  app_message_outbox_send();
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

    if (!name_t || !arrv_t || !line_t || !idx_t || !total_t) return;

    int idx   = safe_int(idx_t);
    int total = safe_int(total_t);
    if (idx < 0 || idx >= MAX_STATIONS) return;
    if (total > MAX_STATIONS) total = MAX_STATIONS;

    StationData *st = &s_stations[idx];
    strncpy(st->name, name_t->value->cstring, MAX_NAME_LEN - 1);
    st->name[MAX_NAME_LEN - 1] = '\0';
    strncpy(st->arrivals, arrv_t->value->cstring, MAX_ARRV_LEN - 1);
    st->arrivals[MAX_ARRV_LEN - 1] = '\0';
    st->line = safe_int(line_t);

    s_total   = total;
    s_loading = false;
    update_display();

  } else if (msg_type == MSG_ERROR) {
    Tuple *err_t = dict_find(iter, KEY_ERROR_MSG);
    s_loading = false;
    s_total   = 0;
    text_layer_set_text(s_station_name, "Error");
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
  vibes_short_pulse();
}

static void down_click_cb(ClickRecognizerRef rec, void *ctx) {
  (void)rec; (void)ctx;
  if (s_total < 2) return;
  s_idx = (s_idx + 1) % s_total;
  update_display();
  vibes_short_pulse();
}

static void select_click_cb(ClickRecognizerRef rec, void *ctx) {
  (void)rec; (void)ctx;
  s_mode    = 1 - s_mode;
  s_loading = true;
  s_total   = 0;
  s_idx     = 0;
  update_display();
  send_request();
  vibes_short_pulse();
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

  /* Adaptive dimensions: larger screens (emery/gabbro ≥ 200 px) get a taller
   * header and more room for the station name. */
  int16_t CB     = (H >= 200) ? 38 : 28;  /* colour-bar height */
  int16_t name_h = (H >= 200) ? 50 : 42;  /* station name height */
  int16_t nav_h  = 16;
  int16_t gap    = 4;

  window_set_background_color(window, GColorBlack);

  /* Status bar — shows current time on the right */
  s_status_bar = status_bar_layer_create();
  status_bar_layer_set_colors(s_status_bar, GColorBlack, GColorWhite);
  status_bar_layer_set_separator_mode(s_status_bar, StatusBarLayerSeparatorModeNone);
  layer_add_child(root, status_bar_layer_get_layer(s_status_bar));

  /* CTA line colour bar */
  s_color_bar = layer_create(GRect(0, SB, W, CB));
  layer_set_update_proc(s_color_bar, color_bar_update_proc);
  layer_add_child(root, s_color_bar);

  /* Line name — left-aligned in colour bar */
  s_line_label = text_layer_create(GRect(6, SB, W - 40, CB));
  text_layer_set_background_color(s_line_label, GColorClear);
  text_layer_set_text_color(s_line_label, GColorWhite);
  text_layer_set_font(s_line_label, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
  text_layer_set_text_alignment(s_line_label, GTextAlignmentLeft);
  layer_add_child(root, text_layer_get_layer(s_line_label));

  /* Station counter — right-aligned in colour bar ("2/5") */
  s_counter_label = text_layer_create(GRect(W - 38, SB, 34, CB));
  text_layer_set_background_color(s_counter_label, GColorClear);
  text_layer_set_text_color(s_counter_label, GColorWhite);
  text_layer_set_font(s_counter_label, fonts_get_system_font(FONT_KEY_GOTHIC_14));
  text_layer_set_text_alignment(s_counter_label, GTextAlignmentRight);
  layer_add_child(root, text_layer_get_layer(s_counter_label));

  /* Station / stop name */
  int16_t name_y = SB + CB + gap;
  s_station_name = text_layer_create(GRect(6, name_y, W - 12, name_h));
  text_layer_set_background_color(s_station_name, GColorClear);
  text_layer_set_text_color(s_station_name, GColorWhite);
  text_layer_set_font(s_station_name, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD));
  text_layer_set_overflow_mode(s_station_name, GTextOverflowModeWordWrap);
  layer_add_child(root, text_layer_get_layer(s_station_name));

  /* Arrivals (fills remaining space above nav bar) */
  int16_t arrv_y = name_y + name_h + gap;
  int16_t arrv_h = H - arrv_y - nav_h;
  s_arrivals = text_layer_create(GRect(6, arrv_y, W - 12, arrv_h));
  text_layer_set_background_color(s_arrivals, GColorClear);
  text_layer_set_text_color(s_arrivals, GColorWhite);
  text_layer_set_font(s_arrivals, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
  text_layer_set_overflow_mode(s_arrivals, GTextOverflowModeWordWrap);
  layer_add_child(root, text_layer_get_layer(s_arrivals));

  /* Nav hints bar */
  s_nav_hints = text_layer_create(GRect(0, H - nav_h, W, nav_h));
  text_layer_set_background_color(s_nav_hints, GColorDarkGray);
  text_layer_set_text_color(s_nav_hints, GColorWhite);
  text_layer_set_font(s_nav_hints, fonts_get_system_font(FONT_KEY_GOTHIC_14));
  text_layer_set_text_alignment(s_nav_hints, GTextAlignmentCenter);
  layer_add_child(root, text_layer_get_layer(s_nav_hints));

  update_display();
}

static void window_unload(Window *window) {
  (void)window;
  text_layer_destroy(s_nav_hints);
  text_layer_destroy(s_arrivals);
  text_layer_destroy(s_station_name);
  text_layer_destroy(s_counter_label);
  text_layer_destroy(s_line_label);
  layer_destroy(s_color_bar);
  status_bar_layer_destroy(s_status_bar);
}

/* ── App init / deinit ──────────────────────────────────────────────────────── */

static void prv_init(void) {
  app_message_open(512, 64);
  app_message_register_inbox_received(inbox_received_cb);
  app_message_register_inbox_dropped(inbox_dropped_cb);

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
  window_destroy(s_window);
}

int main(void) {
  prv_init();
  app_event_loop();
  prv_deinit();
}
