#ifndef ROUTE_RUSH_H
#define ROUTE_RUSH_H

#include <pebble.h>

/* AppMessage keys (must match package.json messageKeys) */
#define KEY_MSG_TYPE      0
#define KEY_STATION_NAME  1
#define KEY_ARRIVALS      2
#define KEY_LINE_COLOR    3
#define KEY_STATION_IDX   4
#define KEY_TOTAL_STNS    5
#define KEY_ERROR_MSG     6
#define KEY_STATION_META  7
#define KEY_THEME         8

/* MsgType values  C->JS */
#define MSG_REQ_TRAIN  0
#define MSG_REQ_BUS    1
/* MsgType values  JS->C */
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

#define REFRESH_MS (60 * 1000)

typedef struct {
  char name[MAX_NAME_LEN];
  char meta[MAX_META_LEN];
  char arrivals[MAX_ARRV_LEN];
  int  line;
} StationData;

typedef struct {
  int mode;
  int idx;
  int total;
  bool loading;
  bool compact_ui;
  bool round_ui;
  int theme_mode;
  int current_line;
  StationData stations[MAX_STATIONS];

  Window *window;
  StatusBarLayer *status_bar;
  Layer *color_bar;
  TextLayer *line_label;
  TextLayer *counter_label;
  TextLayer *station_name;
  TextLayer *station_meta;
  TextLayer *arrivals;
  TextLayer *nav_hints;

  GColor bg_color;
  GColor primary_text_color;
  GColor secondary_text_color;
  GColor nav_bg_color;
  GColor nav_text_color;

  AppTimer *refresh_timer;
  AppTimer *send_retry_timer;
} RouteRushApp;

extern RouteRushApp *g_app;

void route_rush_apply_theme_colors(void);
void route_rush_update_display(void);
void route_rush_send_request(void);
void route_rush_refresh_cb(void *ctx);
void route_rush_inbox_received_cb(DictionaryIterator *iter, void *ctx);
void route_rush_inbox_dropped_cb(AppMessageResult reason, void *ctx);
void route_rush_outbox_failed_cb(DictionaryIterator *iter, AppMessageResult reason, void *ctx);
void route_rush_click_config_provider(void *ctx);
void route_rush_window_load(Window *window);
void route_rush_window_unload(Window *window);

#endif
