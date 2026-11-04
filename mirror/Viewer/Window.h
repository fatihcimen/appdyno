#import "Frame.h"
#import "Viewer.h"

NS_ASSUME_NONNULL_BEGIN

/// The picture's view, exactly the device's screen: what a person's mouse, trackpad and keys land on.
@interface MVView : NSView
@property(nonatomic) CGSize picture;
@property(nonatomic) BOOL inputOn;
/// NO until a person's click, where a window starts so: that click goes no further.
@property(nonatomic) BOOL armed;
/// The controls this kind of device has.
@property(nonatomic, copy) NSArray<NSString *> *controls;
/// What the system's text input holds, before it is typed.
@property(nonatomic, copy, nullable) NSString *composing;
@property(readonly) BOOL takesPointer;
/// Only in the key window, whatever reaches it: what is typed elsewhere is not a device's to have.
@property(readonly) BOOL takesKeys;
- (void)pressButton:(id)sender;
- (NSMenu *)deviceMenu;
@end

@interface MVView (Typing) <NSTextInputClient>
/// Text from the Mac's pasteboard to the device.
- (void)paste:(nullable id)sender;
@end

/// The device around the picture. With no frame it holds the picture and nothing else.
@interface MVFrameView : NSView
@property(nonatomic, weak) MVView *screen;
@property(nonatomic) BOOL showsFrame;
@property(nonatomic) MVFrameSpec spec;
/// What the whole of it takes at this screen size.
- (CGSize)bodyFor:(CGSize)screen turns:(int)turns;
- (void)layOutScreen:(CGSize)screen in:(NSRect)place turns:(int)turns;
- (void)setDriving:(BOOL)driving;
- (void)press:(nullable NSString *)name;
@end

/// The line beneath the device: its name, how it is, and whether an agent is on it.
@interface MVStatusLine : NSTextField
@property(nonatomic, copy, nullable) NSString *name;
@property(nonatomic, copy, nullable) NSString *state;
/// While an agent drives; empty when it does not say what with.
@property(nonatomic, copy, nullable) NSString *tool;
/// Words in its place for a few seconds.
- (void)say:(NSString *)note;
@end

/// A window kept off every screen: it never shows, and the window server still composites it.
@interface MVOffscreenWindow : NSWindow
@property(nonatomic) BOOL offscreen;
/// Drawn as the key window, with no keyboard: only for a picture of it.
@property(nonatomic) BOOL poses;
@end

/// A window as the window server composites it, to a PNG; NO if it cannot.
BOOL MVWriteWindow(NSWindow *window, NSString *file);

/// An image file on the Mac's pasteboard.
void MVCopyImage(NSString *file);

/// A control's words and symbol, by its name.
NSString *MVControlTitle(NSString *name);
NSImage *_Nullable MVControlImage(NSString *name);
/// One menu of the table; with `names`, only what they list.
NSMenu *MVControlMenu(NSString *title, NSArray<NSString *> *_Nullable names);
NSMenu *MVMainMenu(NSArray<NSString *> *_Nullable names);

/// The toolbar's items, for the controls this kind of device has.
@interface MVToolbar : NSObject <NSToolbarDelegate>
- (instancetype)initWithControls:(NSArray<NSString *> *)names target:(id)target;
@end

/// The right-hand pane: Stats, Activity and Apps.
@interface MVInspector : NSVisualEffectView
- (void)showPane:(NSInteger)pane;
- (void)showStats:(NSDictionary *)stats;
- (void)addActivity:(NSDictionary *)call;
- (void)showApps:(NSDictionary *)message;
@end

typedef NS_ENUM(NSInteger, MVShow) { MVShowBehind, MVShowFront, MVShowFocused };

/// How a window shows itself. Only a person's `--focus` gives it the keyboard; a click does the rest.
MVShow MVShowOf(BOOL focus, BOOL behind);

NS_ASSUME_NONNULL_END
