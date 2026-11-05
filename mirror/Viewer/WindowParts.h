// A window's parts, for the files it is split across.
#import "Viewer.h"
#import "Window.h"

NS_ASSUME_NONNULL_BEGIN

@interface MVWindow () {
  MVOffscreenWindow *_window;
  BOOL _hosted;
  NSView *_stage;
  MVFrameView *_frame;
  MVView *_view;
  MVInspector *_inspector;
  NSView *_panel;
  MVToolbar *_bar;
  NSToolbar *_toolbar;
  MVHud *_hud;
  BOOL _hudding, _reading, _recording;
  MVRootView *_root;
  MVBackdrop *_backdrop;
  MVStatusLine *_line;
  MVPictureLayers *_layers;
  CGSize _picture;
  double _zoom;
  int _turns;
  NSString *_name, *_kind;
  NSDictionary *_look;
  BOOL _inspecting;
}
- (double)fitZoom;
- (void)setZoom:(double)zoom;
- (void)setFrameShown:(BOOL)shown;
- (void)toggleInspector;
- (void)toggleHud;
- (void)sayStatus:(NSString *)subtitle;
@end

NS_ASSUME_NONNULL_END
