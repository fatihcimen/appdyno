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

/// A pane of glass around `content`: the system's where it has one, its nearest material where it has not.
NSView *MVGlass(NSView *content, double radius, NSColor *_Nullable tint);
/// A pane comes or goes: a short fade, or at once for a person who asked for less motion.
void MVShowPane(NSView *pane, BOOL shown);
/// A pane takes a colour that means something; nil gives it back.
void MVTintGlass(NSView *pane, NSColor *_Nullable tint);
/// Panes that merge as they near each other, and share one pass.
NSView *MVGlassGroup(NSView *content);
/// A row of glass groups of buttons, each named as a control.
NSView *MVGlassBar(NSArray<NSArray<NSString *> *> *groups, id target, SEL action);

/// A window kept off every screen: it never shows, and the window server still composites it.
@interface MVOffscreenWindow : NSWindow
@property(nonatomic) BOOL offscreen;
/// Drawn as the key window, with no keyboard: only for a picture of it.
@property(nonatomic) BOOL poses;
@end

/// A window as the window server composites it, to a PNG; NO if it cannot.
BOOL MVWriteWindow(NSWindow *window, NSString *file);
BOOL MVWriteWindowPart(NSWindow *window, NSRect part, NSString *file);

/// A few cells of a picture's own colours, for a layer to stretch into a soft mesh with no blur pass. Caller owns it.
CGImageRef _Nullable MVPictureMood(IOSurfaceRef surface, BOOL dark);
/// The same of a decoded stream's image; NULL for a kind of image it cannot read.
CGImageRef _Nullable MVImageMood(CVImageBufferRef image, BOOL dark);
/// What is behind everything in a window: the picture's own colours, so that glass has something of the device to bend.
@interface MVBackdrop : NSObject
- (instancetype)initInView:(NSView *)view window:(NSWindow *)window;
- (void)followSurface:(IOSurfaceRef)surface;
- (void)followImage:(CVImageBufferRef)image;
@end

/// A control's button, however deep in glass it sits.
NSButton *_Nullable MVFindControl(NSView *view, NSString *name);

/// An image file on the Mac's pasteboard.
void MVCopyImage(NSString *file);

/// A control's words and symbol, by its name.
NSString *MVControlTitle(NSString *name);
NSImage *_Nullable MVControlImage(NSString *name);
/// One menu of the table; with `names`, only what they list.
NSMenu *MVControlMenu(NSString *title, NSArray<NSString *> *_Nullable names);
NSMenu *MVMainMenu(NSArray<NSString *> *_Nullable names);
NSMenu *MVHubMenu(void);

typedef NS_ENUM(NSInteger, MVLiveState) { MVLiveNeutral, MVLiveGood, MVLiveWarning, MVLiveCritical };
/// How a reading stands: what a card says in words and a symbol, as well as a colour.
MVLiveState MVStateOf(NSString *field, double value);
/// How a frame rate stands. It has no right value, as a screen draws what it has to: what can be judged is whether what it
/// drew came on time, and where that is not counted it stands neutral.
MVLiveState MVFramesState(NSDictionary *sample);
/// A measure's reading, or where a device counts no frames the window's own rate; nil for none.
NSNumber *_Nullable MVReadingOf(NSDictionary *sample, NSString *field, NSNumber *_Nullable pictureRate);
/// A reading in the words a person reads it in.
NSString *MVReadingWords(double value, NSString *unit);
/// The system's rounded face, for numbers.
NSFont *MVRoundedFont(CGFloat size, NSFontWeight weight);

/// A measure's last readings: a baseline, a line at `usual`, its readings, and a mark where a stutter fell.
@interface MVSpark : NSView
@property(nonatomic) double usual;
/// How many readings it holds: a minute's, unless told.
@property(nonatomic) int capacity;
@property(nonatomic, nullable) NSColor *color;
- (void)add:(double)value;
/// The second to come holds a stutter, or does not.
- (void)mark;
- (void)pass;
@end

static const double MVHudWidth = 188;

/// The live numbers beside the device, as glass cards; a `perf` message each second fills them.
@interface MVHud : NSView
- (void)show:(NSDictionary *)message;
/// Frames shown a second, as the window counts them: what the frame rate says where the device has no count.
- (void)setPictureRate:(double)rate;
/// What a measure's card says now.
- (NSString *)shownFor:(NSString *)field;
- (NSString *)whyFor:(NSString *)field;
@end

/// One line of a list.
@interface MVRow : NSObject
@property(nonatomic, copy) NSString *title;
@property(nonatomic, copy) NSString *detail;
/// All there is to say of it, where a line has no room.
@property(nonatomic, copy, nullable) NSString *help;
@property(nonatomic, copy, nullable) NSString *symbol;
@property(nonatomic, nullable) NSColor *tint;
@property(nonatomic, copy, nullable) NSString *key;
/// A heading over the rows beneath it, which cannot be chosen.
@property(nonatomic) BOOL header;
+ (instancetype)headerNamed:(NSString *)title;
@end

@interface MVList : NSScrollView <NSTableViewDataSource, NSTableViewDelegate>
@property(nonatomic, copy) NSArray<MVRow *> *rows;
@property(nonatomic, copy, nullable) void (^onSelect)(MVRow *_Nullable row);
@property(nonatomic, readonly, nullable) MVRow *selected;
- (void)scrollToEnd;
- (void)useSidebarStyle;
@end

/// The layers of a device's screen: a surface's or a stream's picture, a cutout where it has none, and a dimming.
@interface MVPictureLayers : NSObject
- (instancetype)initInView:(NSView *)view;
- (void)showSurface:(IOSurfaceRef)surface;
/// Whether the layer took it.
- (BOOL)showImage:(CVImageBufferRef)image;
- (void)setDimmed:(BOOL)dimmed;
/// `cutout` is in a portrait screen's flipped coordinates; empty for none.
- (void)layOut:(CGSize)screen turns:(int)turns cutout:(CGRect)cutout;
@end

/// A longer look at the readings, and the real measures of the app in front, which the parent runs.
@interface MVPerfPane : NSView
- (instancetype)initWithFrame:(NSRect)frame target:(id)target;
- (void)setPictureRate:(double)rate;
- (void)show:(NSDictionary *)message;
- (void)showMeasuring:(NSString *)line;
- (void)showMeasured:(NSDictionary *)result;
/// What the last measure came to, and how a line of the readings stands.
- (NSString *)lastResult;
- (BOOL)lastMarked;
- (NSString *)shownFor:(NSString *)field;
@end

/// The right-hand pane: Stats, Activity, Apps and Performance. Glass is around it: all it has inside is fills.
@interface MVInspector : NSView
- (instancetype)initWithFrame:(NSRect)frame target:(id)target;
@property(nonatomic, readonly) MVPerfPane *perf;
/// Whether Performance is the pane chosen.
@property(nonatomic, readonly) BOOL readings;
/// A pane was chosen.
@property(nonatomic, copy, nullable) void (^onPane)(void);
- (void)showPane:(NSInteger)pane;
- (void)showStats:(NSDictionary *)stats;
- (void)addActivity:(NSDictionary *)call;
- (void)showApps:(NSDictionary *)message;
@end

typedef NS_ENUM(NSInteger, MVShow) { MVShowBehind, MVShowFront, MVShowFocused };

/// How a window shows itself. Only a person's `--focus` gives it the keyboard; a click does the rest.
MVShow MVShowOf(BOOL focus, BOOL behind);
void MVPresent(MVOffscreenWindow *window, MVShow how);

/// The window of `appdyno hub`: what its parent says is there, and what a person asks of it.
@interface MVHub : NSObject <NSWindowDelegate, NSToolbarDelegate>
- (instancetype)initWithShow:(MVShow)how poses:(BOOL)poses;
- (void)show:(NSDictionary *)message;
- (void)sayNote:(NSString *)note;
/// Presses a device's button as a person does.
- (void)poke:(NSDictionary *)message;
- (BOOL)snapshot:(NSString *)file;
@end

NS_ASSUME_NONNULL_END
