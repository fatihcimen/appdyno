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
  MVInspectorSlot *_slot;
  MVToolbar *_bar;
  NSToolbar *_toolbar;
  MVHud *_hud;
  BOOL _hudding, _reading, _recording, _waitingForPerson;
  __weak MVRoomView *_room;
  MVRootView *_root;
  MVBackdrop *_backdrop;
  NSInteger _side;
  MVStatusLine *_line;
  MVPictureLayers *_layers;
  CGSize _picture;
  double _zoom;
  int _turns;
  NSString *_name, *_kind;
  NSDictionary *_look;
  NSPopover *_numbers;
}
- (double)fitZoom;
- (void)setZoom:(double)zoom;
- (void)setFrameShown:(BOOL)shown;
- (void)toggleInspector;
- (void)layoutPicture;
- (void)watchReadings;
- (void)toggleHud;
- (void)showState;
@end

@interface MVWindow (Inspector)
- (void)splitAround:(NSView *)root;
- (void)holdInspector;
- (void)letGoOfInspector;
- (void)openInspector:(BOOL)open;
/// Where the device stands and where the Inspector does, in the window: nothing may stand over a device.
@property(nonatomic, readonly) NSRect deviceInWindow, inspectorInWindow;
@end

NS_ASSUME_NONNULL_END
