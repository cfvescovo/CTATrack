#include "cta_track.h"

static int safe_int(Tuple *tuple) {
  if (!tuple) return 0;
  switch (tuple->length) {
    case 1:  return (int)tuple->value->int8;
    case 2:  return (int)tuple->value->int16;
    default: return (int)tuple->value->int32;
  }
}

static void send_retry_cb(void *ctx) {
  (void)ctx;
  g_app->send_retry_timer = NULL;
  route_rush_send_request();
}

void route_rush_outbox_failed_cb(DictionaryIterator *iter, AppMessageResult reason, void *ctx) {
  (void)iter;
  (void)ctx;
  APP_LOG(APP_LOG_LEVEL_ERROR, "Outbox failed: %d", (int)reason);
  if (!g_app->send_retry_timer) {
    g_app->send_retry_timer = app_timer_register(300, send_retry_cb, NULL);
  }
}

void route_rush_send_request(void) {
  if (g_app->send_retry_timer) {
    app_timer_cancel(g_app->send_retry_timer);
    g_app->send_retry_timer = NULL;
  }

  DictionaryIterator *iter;
  AppMessageResult result = app_message_outbox_begin(&iter);
  if (result == APP_MSG_BUSY) {
    g_app->send_retry_timer = app_timer_register(200, send_retry_cb, NULL);
    return;
  }
  if (result != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Outbox begin failed: %d", (int)result);
    return;
  }

  dict_write_uint8(iter, KEY_MSG_TYPE, g_app->mode == 0 ? MSG_REQ_TRAIN : MSG_REQ_BUS);
  result = app_message_outbox_send();
  if (result != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Outbox send failed: %d", (int)result);
    if (!g_app->send_retry_timer) {
      g_app->send_retry_timer = app_timer_register(300, send_retry_cb, NULL);
    }
  }
}

void route_rush_inbox_received_cb(DictionaryIterator *iter, void *ctx) {
  (void)ctx;
  Tuple *type_t = dict_find(iter, KEY_MSG_TYPE);
  if (!type_t) return;

  int msg_type = safe_int(type_t);
  if (msg_type == MSG_STATION) {
    Tuple *name_t = dict_find(iter, KEY_STATION_NAME);
    Tuple *arrivals_t = dict_find(iter, KEY_ARRIVALS);
    Tuple *line_t = dict_find(iter, KEY_LINE_COLOR);
    Tuple *idx_t = dict_find(iter, KEY_STATION_IDX);
    Tuple *total_t = dict_find(iter, KEY_TOTAL_STNS);
    Tuple *meta_t = dict_find(iter, KEY_STATION_META);

    if (!name_t || !arrivals_t || !line_t || !idx_t || !total_t) return;

    int idx = safe_int(idx_t);
    int total = safe_int(total_t);
    if (idx < 0 || idx >= MAX_STATIONS) return;
    if (total > MAX_STATIONS) total = MAX_STATIONS;

    StationData *station = &g_app->stations[idx];
    strncpy(station->name, name_t->value->cstring, MAX_NAME_LEN - 1);
    station->name[MAX_NAME_LEN - 1] = '\0';

    if (meta_t && meta_t->type == TUPLE_CSTRING) {
      strncpy(station->meta, meta_t->value->cstring, MAX_META_LEN - 1);
      station->meta[MAX_META_LEN - 1] = '\0';
    } else {
      station->meta[0] = '\0';
    }

    strncpy(station->arrivals, arrivals_t->value->cstring, MAX_ARRV_LEN - 1);
    station->arrivals[MAX_ARRV_LEN - 1] = '\0';
    station->line = safe_int(line_t);

    g_app->total = total;
    g_app->loading = false;
    route_rush_update_display();
    return;
  }

  if (msg_type == MSG_THEME) {
    Tuple *theme_t = dict_find(iter, KEY_THEME);
    int theme = safe_int(theme_t);
    if (theme == THEME_LIGHT || theme == THEME_DARK || theme == THEME_AUTO) {
      g_app->theme_mode = theme;
    } else {
      g_app->theme_mode = THEME_AUTO;
    }
    persist_write_int(PERSIST_KEY_THEME_MODE, g_app->theme_mode);
    route_rush_update_display();
    return;
  }

  if (msg_type == MSG_ERROR) {
    Tuple *error_t = dict_find(iter, KEY_ERROR_MSG);
    g_app->loading = false;
    g_app->total = 0;
    text_layer_set_text(g_app->station_name, "Error");
    text_layer_set_text(g_app->station_meta, "");
    text_layer_set_text(g_app->arrivals, error_t ? error_t->value->cstring : "Unknown error");
    layer_mark_dirty(g_app->color_bar);
  }
}

void route_rush_inbox_dropped_cb(AppMessageResult reason, void *ctx) {
  (void)ctx;
  APP_LOG(APP_LOG_LEVEL_WARNING, "AppMessage dropped: %d", (int)reason);
}

void route_rush_refresh_cb(void *ctx) {
  (void)ctx;
  g_app->loading = true;
  g_app->total = 0;
  g_app->idx = 0;
  route_rush_update_display();
  route_rush_send_request();
  g_app->refresh_timer = app_timer_register(REFRESH_MS, route_rush_refresh_cb, NULL);
}
