#include "cta_track.h"

static const char * const LINE_NAMES[] = {
  "RED LINE", "BLUE LINE", "BROWN LINE", "GREEN LINE",
  "ORANGE LINE", "PINK LINE", "PURPLE LINE", "YELLOW LINE", "BUS"
};

static int theme_from_local_time(void) {
  time_t now = time(NULL);
  struct tm *local_time = localtime(&now);
  if (!local_time) return THEME_DARK;
  return (local_time->tm_hour >= 8 && local_time->tm_hour < 20) ? THEME_LIGHT : THEME_DARK;
}

static int resolved_theme_mode(void) {
  if (g_app->theme_mode == THEME_LIGHT || g_app->theme_mode == THEME_DARK) {
    return g_app->theme_mode;
  }
  return theme_from_local_time();
}

static bool ui_ready(void) {
  return g_app->window && g_app->nav_hints && g_app->station_name &&
         g_app->station_meta && g_app->arrivals && g_app->status_bar;
}

void route_rush_apply_theme_colors(void) {
  bool light = (resolved_theme_mode() == THEME_LIGHT);
  g_app->bg_color = light ? GColorWhite : GColorBlack;
  g_app->primary_text_color = light ? GColorBlack : GColorWhite;
  g_app->secondary_text_color = light ? GColorDarkGray : GColorLightGray;
  g_app->nav_bg_color = light ? GColorLightGray : GColorDarkGray;
  g_app->nav_text_color = light ? GColorBlack : GColorWhite;

  if (!ui_ready()) return;

  window_set_background_color(g_app->window, g_app->bg_color);
  status_bar_layer_set_colors(g_app->status_bar, g_app->bg_color, g_app->primary_text_color);
  text_layer_set_text_color(g_app->station_name, g_app->primary_text_color);
  text_layer_set_text_color(g_app->station_meta, g_app->secondary_text_color);
  text_layer_set_text_color(g_app->arrivals, g_app->primary_text_color);
  text_layer_set_background_color(g_app->nav_hints, g_app->round_ui ? GColorClear : g_app->nav_bg_color);
  text_layer_set_text_color(g_app->nav_hints, g_app->round_ui ? g_app->secondary_text_color : g_app->nav_text_color);
}

static GColor get_line_color(int line) {
#ifdef PBL_COLOR
  switch (line) {
    case LINE_RED:    return GColorFromRGB(198,  12,  48);
    case LINE_BLUE:   return GColorFromRGB(  0, 161, 222);
    case LINE_BROWN:  return GColorFromRGB( 98,  54,  27);
    case LINE_GREEN:  return GColorFromRGB(  0, 155,  58);
    case LINE_ORANGE: return GColorFromRGB(249,  70,  28);
    case LINE_PINK:   return GColorFromRGB(226, 126, 166);
    case LINE_PURPLE: return GColorFromRGB( 82,  35, 152);
    case LINE_YELLOW: return GColorFromRGB(249, 227,   0);
    case LINE_BUS:    return GColorFromRGB(  0, 102,  51);
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

static void color_bar_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  graphics_context_set_fill_color(ctx, get_line_color(g_app->current_line));
  graphics_fill_rect(ctx, bounds, g_app->round_ui ? 10 : 0, g_app->round_ui ? GCornersAll : GCornerNone);
}

static void apply_mode_bar(void) {
  g_app->current_line = (g_app->mode == 1) ? LINE_BUS : LINE_RED;
  GColor text_color = get_text_on_line(g_app->current_line);
  text_layer_set_text_color(g_app->line_label, text_color);
  text_layer_set_text_color(g_app->counter_label, text_color);
  text_layer_set_text(g_app->line_label, g_app->mode == 0 ? "TRAIN" : "BUS");
  layer_mark_dirty(g_app->color_bar);
}

void route_rush_update_display(void) {
  static char nav_hint_buf[64];

  route_rush_apply_theme_colors();
  if (g_app->round_ui || g_app->compact_ui) {
    snprintf(nav_hint_buf, sizeof(nav_hint_buf), "^v next  SEL %s",
             g_app->mode == 0 ? "BUS" : "TRAIN");
  } else {
    snprintf(nav_hint_buf, sizeof(nav_hint_buf), "^v : next %s | SEL: %s",
             g_app->mode == 0 ? "stop" : "station", g_app->mode == 0 ? "BUS" : "TRAIN");
  }

  if (g_app->loading) {
    apply_mode_bar();
    text_layer_set_text(g_app->counter_label, "...");
    text_layer_set_text(g_app->station_name, "Locating...");
    text_layer_set_text(g_app->station_meta, "Searching nearby");
    text_layer_set_text(g_app->arrivals, "Contacting CTA");
    text_layer_set_text(g_app->nav_hints, nav_hint_buf);
    return;
  }

  if (g_app->total == 0) {
    apply_mode_bar();
    text_layer_set_text(g_app->counter_label, "0");
    text_layer_set_text(g_app->station_name, "No results");
    text_layer_set_text(g_app->station_meta, "");
    text_layer_set_text(g_app->arrivals, "None found nearby");
    text_layer_set_text(g_app->nav_hints, nav_hint_buf);
    return;
  }

  StationData *station = &g_app->stations[g_app->idx];
  g_app->current_line = station->line;

  GColor text_color = get_text_on_line(g_app->current_line);
  text_layer_set_text_color(g_app->line_label, text_color);
  text_layer_set_text_color(g_app->counter_label, text_color);

  if (station->line >= 0 && station->line <= LINE_BUS) {
    text_layer_set_text(g_app->line_label, LINE_NAMES[station->line]);
  } else {
    text_layer_set_text(g_app->line_label, g_app->mode == 0 ? "TRAIN" : "BUS");
  }

  static char counter_buf[24];
  snprintf(counter_buf, sizeof(counter_buf), "%d/%d", g_app->idx + 1, g_app->total);
  text_layer_set_text(g_app->counter_label, counter_buf);

  text_layer_set_text(g_app->station_name, station->name);
  text_layer_set_text(g_app->station_meta, station->meta);
  text_layer_set_text(g_app->arrivals, station->arrivals[0] ? station->arrivals : "No arrivals");
  text_layer_set_text(g_app->nav_hints, nav_hint_buf);

  layer_mark_dirty(g_app->color_bar);
}

static void up_click_cb(ClickRecognizerRef rec, void *ctx) {
  (void)rec;
  (void)ctx;
  if (g_app->total < 2) return;
  g_app->idx = (g_app->idx - 1 + g_app->total) % g_app->total;
  route_rush_update_display();
}

static void down_click_cb(ClickRecognizerRef rec, void *ctx) {
  (void)rec;
  (void)ctx;
  if (g_app->total < 2) return;
  g_app->idx = (g_app->idx + 1) % g_app->total;
  route_rush_update_display();
}

static void select_click_cb(ClickRecognizerRef rec, void *ctx) {
  (void)rec;
  (void)ctx;
  g_app->mode = 1 - g_app->mode;
  g_app->loading = true;
  g_app->total = 0;
  g_app->idx = 0;
  route_rush_update_display();
  route_rush_send_request();
}

void route_rush_click_config_provider(void *ctx) {
  (void)ctx;
  window_single_click_subscribe(BUTTON_ID_UP, up_click_cb);
  window_single_click_subscribe(BUTTON_ID_DOWN, down_click_cb);
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click_cb);
}

void route_rush_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);
  int16_t W = bounds.size.w;
  int16_t H = bounds.size.h;
  int16_t SB = STATUS_BAR_LAYER_HEIGHT;
#if defined(PBL_ROUND)
  g_app->round_ui = true;
  int16_t side_pad = (W >= 200) ? 28 : 22;
  int16_t top_pad = (W >= 200) ? 14 : 10;
  int16_t bottom_pad = (W >= 200) ? 20 : 14;
#else
  g_app->round_ui = false;
  int16_t side_pad = 6;
  int16_t top_pad = 0;
  int16_t bottom_pad = 0;
#endif
  int16_t content_x = side_pad;
  int16_t content_w = W - (side_pad * 2);
  int16_t header_inset = g_app->round_ui ? 18 : 0;
  int16_t body_inset = g_app->round_ui ? 10 : 0;
  int16_t header_x = content_x + header_inset;
  int16_t header_w = content_w - (header_inset * 2);
  int16_t body_x = content_x + body_inset;
  int16_t body_w = content_w - (body_inset * 2);

  g_app->compact_ui = (H < 200);
  int16_t color_bar_h = g_app->compact_ui ? 24 : (g_app->round_ui ? 32 : 38);
  int16_t name_h = g_app->compact_ui ? 20 : (g_app->round_ui ? 58 : 46);
  int16_t meta_h = g_app->compact_ui ? 14 : 18;
  int16_t nav_h = g_app->compact_ui ? 14 : (g_app->round_ui ? 12 : 16);
  int16_t gap = g_app->compact_ui ? 2 : (g_app->round_ui ? 6 : 4);
  int16_t counter_w = g_app->round_ui ? 42 : (g_app->compact_ui ? 28 : 42);
  int16_t counter_margin = g_app->round_ui ? 48 : (g_app->compact_ui ? 34 : 48);

  route_rush_apply_theme_colors();

  g_app->status_bar = status_bar_layer_create();
  status_bar_layer_set_colors(g_app->status_bar, GColorBlack, GColorWhite);
  status_bar_layer_set_separator_mode(g_app->status_bar, StatusBarLayerSeparatorModeNone);
  layer_add_child(root, status_bar_layer_get_layer(g_app->status_bar));

  g_app->color_bar = layer_create(GRect(header_x, SB + top_pad, header_w, color_bar_h));
  layer_set_update_proc(g_app->color_bar, color_bar_update_proc);
  layer_add_child(root, g_app->color_bar);

  g_app->line_label = text_layer_create(GRect(header_x + 10, SB + top_pad, header_w - counter_margin - 10, color_bar_h));
  text_layer_set_background_color(g_app->line_label, GColorClear);
  text_layer_set_text_color(g_app->line_label, GColorWhite);
  text_layer_set_font(g_app->line_label, fonts_get_system_font(g_app->compact_ui ? FONT_KEY_GOTHIC_14_BOLD : (g_app->round_ui ? FONT_KEY_GOTHIC_24_BOLD : FONT_KEY_GOTHIC_18_BOLD)));
  text_layer_set_text_alignment(g_app->line_label, GTextAlignmentLeft);
  layer_add_child(root, text_layer_get_layer(g_app->line_label));

  g_app->counter_label = text_layer_create(GRect(header_x + header_w - counter_margin, SB + top_pad, counter_w, color_bar_h));
  text_layer_set_background_color(g_app->counter_label, GColorClear);
  text_layer_set_text_color(g_app->counter_label, GColorWhite);
  text_layer_set_font(g_app->counter_label, fonts_get_system_font(g_app->compact_ui ? FONT_KEY_GOTHIC_14 : FONT_KEY_GOTHIC_18_BOLD));
  text_layer_set_text_alignment(g_app->counter_label, GTextAlignmentRight);
  layer_add_child(root, text_layer_get_layer(g_app->counter_label));

  int16_t name_y = SB + top_pad + color_bar_h + gap;
  g_app->station_name = text_layer_create(GRect(body_x, name_y, body_w, name_h));
  text_layer_set_background_color(g_app->station_name, GColorClear);
  text_layer_set_text_color(g_app->station_name, GColorWhite);
  text_layer_set_font(g_app->station_name, fonts_get_system_font(g_app->compact_ui ? FONT_KEY_GOTHIC_14_BOLD : (g_app->round_ui ? FONT_KEY_GOTHIC_24_BOLD : FONT_KEY_GOTHIC_24_BOLD)));
  text_layer_set_overflow_mode(g_app->station_name, (g_app->compact_ui && !g_app->round_ui) ? GTextOverflowModeTrailingEllipsis : GTextOverflowModeWordWrap);
  text_layer_set_text_alignment(g_app->station_name, GTextAlignmentLeft);
  layer_add_child(root, text_layer_get_layer(g_app->station_name));

  int16_t meta_y = name_y + name_h + gap;
  g_app->station_meta = text_layer_create(GRect(body_x, meta_y, body_w, meta_h));
  text_layer_set_background_color(g_app->station_meta, GColorClear);
  text_layer_set_text_color(g_app->station_meta, GColorLightGray);
  text_layer_set_font(g_app->station_meta, fonts_get_system_font(g_app->compact_ui ? FONT_KEY_GOTHIC_14 : FONT_KEY_GOTHIC_18));
  text_layer_set_text_alignment(g_app->station_meta, GTextAlignmentLeft);
  layer_add_child(root, text_layer_get_layer(g_app->station_meta));

  int16_t arrv_y = meta_y + meta_h + gap;
  int16_t arrv_h = (H - bottom_pad) - arrv_y - nav_h;
  g_app->arrivals = text_layer_create(GRect(body_x, arrv_y, body_w, arrv_h));
  text_layer_set_background_color(g_app->arrivals, GColorClear);
  text_layer_set_text_color(g_app->arrivals, GColorWhite);
  text_layer_set_font(g_app->arrivals, fonts_get_system_font(g_app->compact_ui ? FONT_KEY_GOTHIC_14_BOLD : FONT_KEY_GOTHIC_18_BOLD));
  text_layer_set_overflow_mode(g_app->arrivals, GTextOverflowModeWordWrap);
  text_layer_set_text_alignment(g_app->arrivals, GTextAlignmentLeft);
  layer_add_child(root, text_layer_get_layer(g_app->arrivals));

  g_app->nav_hints = text_layer_create(GRect(body_x, H - bottom_pad - nav_h, body_w, nav_h));
  text_layer_set_background_color(g_app->nav_hints, g_app->round_ui ? GColorClear : GColorDarkGray);
  text_layer_set_text_color(g_app->nav_hints, g_app->round_ui ? g_app->secondary_text_color : GColorWhite);
  text_layer_set_font(g_app->nav_hints, fonts_get_system_font((g_app->compact_ui || g_app->round_ui) ? FONT_KEY_GOTHIC_09 : FONT_KEY_GOTHIC_14));
  text_layer_set_text_alignment(g_app->nav_hints, GTextAlignmentCenter);
  layer_add_child(root, text_layer_get_layer(g_app->nav_hints));

  route_rush_apply_theme_colors();
  route_rush_update_display();
}

void route_rush_window_unload(Window *window) {
  (void)window;
  text_layer_destroy(g_app->nav_hints);
  text_layer_destroy(g_app->arrivals);
  text_layer_destroy(g_app->station_meta);
  text_layer_destroy(g_app->station_name);
  text_layer_destroy(g_app->counter_label);
  text_layer_destroy(g_app->line_label);
  layer_destroy(g_app->color_bar);
  status_bar_layer_destroy(g_app->status_bar);
}
