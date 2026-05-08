#include "cta_track.h"

static RouteRushApp s_app = {
  .loading = true,
  .theme_mode = THEME_AUTO,
  .current_line = LINE_RED,
};

RouteRushApp *g_app = &s_app;

static void prv_init(void) {
  if (persist_exists(PERSIST_KEY_THEME_MODE)) {
    int persisted_theme_mode = persist_read_int(PERSIST_KEY_THEME_MODE);
    if (persisted_theme_mode == THEME_LIGHT || persisted_theme_mode == THEME_DARK || persisted_theme_mode == THEME_AUTO) {
      g_app->theme_mode = persisted_theme_mode;
    }
  }

  app_message_open(1024, 256);
  app_message_register_inbox_received(route_rush_inbox_received_cb);
  app_message_register_inbox_dropped(route_rush_inbox_dropped_cb);
  app_message_register_outbox_failed(route_rush_outbox_failed_cb);

  g_app->window = window_create();
  window_set_click_config_provider(g_app->window, route_rush_click_config_provider);
  window_set_window_handlers(g_app->window, (WindowHandlers){
    .load = route_rush_window_load,
    .unload = route_rush_window_unload,
  });
  window_stack_push(g_app->window, true);

  route_rush_send_request();
  g_app->refresh_timer = app_timer_register(REFRESH_MS, route_rush_refresh_cb, NULL);
}

static void prv_deinit(void) {
  if (g_app->refresh_timer) app_timer_cancel(g_app->refresh_timer);
  if (g_app->send_retry_timer) app_timer_cancel(g_app->send_retry_timer);
  window_destroy(g_app->window);
}

int main(void) {
  prv_init();
  app_event_loop();
  prv_deinit();
}
