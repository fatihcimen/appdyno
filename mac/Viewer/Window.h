#import "Frame.h"
#import "Inspector.h"
#import "Style.h"
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
/// What a device menu's items go to.
@property(nonatomic, weak, nullable) id menuTarget;
/// The pointer's place is asked about, as the Flow pane shows.
@property(nonatomic) BOOL inspects;
/// What a click does instead of touching the device: `copy` or `assert`; nil: it touches.
@property(nonatomic, copy, nullable) NSString *clickDoes;
/// What the system's text input holds, before it is typed.
@property(nonatomic, copy, nullable) NSString *composing;
/// A person's mouse came down on it.
@property(nonatomic, copy, nullable) void (^onTouched)(void);
@property(readonly) BOOL takesPointer;
/// Only in a key window a person has clicked, whatever reaches it: what is typed elsewhere is not a device's to have.
@property(readonly) BOOL takesKeys;
- (void)pressButton:(id)sender;
- (NSMenu *)deviceMenu;
/// A rectangle over the element named, as fractions of the picture; nil takes it away.
- (void)showMark:(nullable NSDictionary *)rect;
@end

@interface MVView (Typing) <NSTextInputClient>
/// Text from the Mac's pasteboard to the device.
- (void)paste:(nullable id)sender;
/// Text to the device, past the keyboard's own checks: for what is driven with no key at all.
- (void)typeText:(NSString *)text;
@end

/// The device around the picture. With no frame it holds the picture and nothing else.
@interface MVFrameView : NSView
@property(nonatomic, weak) MVView *screen;
@property(nonatomic) BOOL showsFrame;
@property(nonatomic) MVFrameSpec spec;
/// What the whole of it takes at this screen size.
- (CGSize)bodyFor:(CGSize)screen;
- (void)layOutScreen:(CGSize)screen in:(NSRect)place;
/// A colour around the device; none takes it away.
- (void)setEdge:(nullable NSColor *)color;
- (void)press:(nullable NSString *)name;
@end

/// Where a window of two stands in this room: on its side of the middle, tops level, and never off its left.
NSPoint MVBesideOrigin(NSRect room, NSSize size, BOOL left);

typedef NS_ENUM(NSInteger, MVTone) { MVToneLive,
                                     MVToneBusy,
                                     MVToneNeedsYou,
                                     MVToneAgent,
                                     MVToneBad };

/// All that is happening to a device, and the one thing to say of it now.
@interface MVStatusLine : NSObject
/// A note it said has run out.
@property(nonatomic, copy, nullable) void (^onChange)(void);
/// What it says now.
@property(nonatomic, readonly) NSString *stringValue;
@property(nonatomic, readonly) MVTone tone;
@property(nonatomic, copy, nullable) NSString *name;
/// What the hub's row says under the name: a window of its own has none.
@property(nonatomic, copy, nullable) NSString *about;
@property(nonatomic, copy, nullable) NSString *state;
/// The picture is live, and `state` is only how to say so.
@property(nonatomic) BOOL live;
/// A person has something to do before it can be.
@property(nonatomic) BOOL stuck;
/// Frames shown a second, where they move.
@property(nonatomic) double rate;
/// How a phone is joined to this Mac.
@property(nonatomic, copy, nullable) NSString *link;
/// While an agent drives; empty when it does not say what with.
@property(nonatomic, copy, nullable) NSString *tool;
/// The AI client that drives, where it says.
@property(nonatomic, copy, nullable) NSString *client;
/// What a measure is at, and how far, as a part of 1.
@property(nonatomic, copy, nullable) NSString *measuring;
@property(nonatomic) double progress;
@property(nonatomic) BOOL recording;
/// Where a touch goes, beside another window.
@property(nonatomic, copy, nullable) NSString *pairing;
/// A touch goes to both.
@property(nonatomic) BOOL both;
/// What went wrong on this device, until a touch lands.
@property(nonatomic, copy, nullable) NSString *failing;
/// Words in its place for a few seconds.
- (void)say:(NSString *)note;
@end

/// A pane of glass around `content`: the system's where it has one, its nearest material where it has not.
NSView *MVGlass(NSView *content, double radius, BOOL holdsControls);
/// A pane comes or goes: a short fade, or at once for a person who asked for less motion.
void MVShowPane(NSView *pane, BOOL shown);
/// Panes that merge as they near each other, and share one pass.
NSView *MVGlassGroup(NSView *content);

/// A window kept off every screen: it never shows, and the window server still composites it.
@interface MVOffscreenWindow : NSWindow
@property(nonatomic) BOOL offscreen;
/// Drawn as the key window, with no keyboard: only for a picture of it.
@property(nonatomic) BOOL poses;
/// A person's mouse came down in it since it last had the keyboard, or they asked for it with `--focus`. Being key is not
/// enough for a device to hear anything: a window may be handed the keyboard by what started it, with a person typing elsewhere.
@property(nonatomic) BOOL personHere;
@end

/// Whether what `current` is may act on a device from `window`: a shortcut lands in whatever is key, and only counts in a
/// window a person has clicked.
BOOL MVShortcutMayAct(NSEvent *_Nullable current, MVOffscreenWindow *window);

/// A window as the window server composites it, to a PNG; NO if it cannot.
BOOL MVWriteWindow(NSWindow *window, NSString *file);
BOOL MVWriteWindowPart(NSWindow *window, NSRect part, NSString *file);
/// Every word and symbol a window shows, with where it stands from its top left: how its contrast is read off a picture.
NSArray<NSDictionary *> *MVWindowParts(NSWindow *window);

/// A few cells of a picture's own colours, for a layer to stretch into a soft mesh with no blur pass. Caller owns it.
CGImageRef _Nullable MVPictureMood(IOSurfaceRef surface, BOOL dark) CF_RETURNS_RETAINED;
/// The same of a decoded stream's image; NULL for a kind of image it cannot read.
CGImageRef _Nullable MVImageMood(CVImageBufferRef image, BOOL dark) CF_RETURNS_RETAINED;
/// What is behind everything in a window: the palette's ground, joined by the picture's own colours, so that glass has
/// something to show whatever the device does.
@interface MVBackdrop : NSObject
- (instancetype)initInView:(NSView *)view window:(NSWindow *)window;
/// A picture's colours, on `side` of the window: 0 or 1 of two devices, or -1 for one alone.
- (void)followSurface:(IOSurfaceRef)surface side:(NSInteger)side;
- (void)followImage:(CVImageBufferRef)image side:(NSInteger)side;
/// A place's colours; 0 for a device.
- (void)showPlace:(NSInteger)place;
/// The look changed.
- (void)repaint;
@end

/// A mouse's click at a point of a window, posted to this process as the window server would send it.
void MVRealClick(NSWindow *window, NSPoint at);
/// The same on a control, wherever it is scrolled to, and what the click landed on, for the parent.
NSDictionary *MVClickControl(NSWindow *window, NSButton *_Nullable button, NSString *name);

/// The symbol of what holds a device up, by the name `NEEDS` has for it.
NSString *MVNeedSymbol(NSString *_Nullable need);

/// A control's button, however deep in glass it sits.
NSButton *_Nullable MVFindControl(NSView *view, NSString *name);

/// An image file on the Mac's pasteboard.
void MVCopyImage(NSString *file);

/// A control's words and symbol, by its name.
NSString *MVControlTitle(NSString *name);
NSImage *_Nullable MVControlImage(NSString *name);
NSString *MVControlSymbol(NSString *name);
/// One menu of the table; with `names`, only what they list.
NSMenu *MVControlMenu(NSString *title, NSArray<NSString *> *_Nullable names);
NSMenu *MVMainMenu(NSArray<NSString *> *_Nullable names);
NSMenu *MVHubMenu(void);

typedef NS_ENUM(NSInteger, MVLiveState) { MVLiveNeutral,
                                          MVLiveGood,
                                          MVLiveWarning,
                                          MVLiveCritical };
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
/// From its first readings it takes the whole width.
@property(nonatomic) BOOL fills;
/// It stands even while nothing has moved: a row that came and went would move all under it.
@property(nonatomic) BOOL stays;
@property(nonatomic) double usual;
/// How many readings it holds: a minute's, unless told.
@property(nonatomic) int capacity;
@property(nonatomic, nullable) NSColor *color;
/// A soft fall of its colour under the line, and a mark at its end.
@property(nonatomic) BOOL glows;
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
/// A small mark of how a device is, and the shape that says it where colour is not to be relied on.
@property(nonatomic, nullable) NSColor *dot;
@property(nonatomic, copy, nullable) NSString *dotShape;
@property(nonatomic, copy) NSString *title;
@property(nonatomic, copy) NSString *detail;
/// All there is to say of it, where a line has no room.
@property(nonatomic, copy, nullable) NSString *help;
@property(nonatomic, copy, nullable) NSString *symbol;
@property(nonatomic, nullable) NSColor *tint;
/// Its symbol stands on a tile of this colour.
@property(nonatomic, nullable) NSColor *tile;
@property(nonatomic, copy, nullable) NSString *key;
/// A heading over the rows beneath it, which cannot be chosen.
@property(nonatomic) BOOL header;
+ (instancetype)headerNamed:(NSString *)title;
@end

@interface MVList : NSScrollView <NSTableViewDataSource, NSTableViewDelegate>
@property(nonatomic, copy) NSArray<MVRow *> *rows;
@property(nonatomic, copy, nullable) void (^onSelect)(MVRow *_Nullable row);
/// A row is something to press, and none is ever selected: a second click on it means as much as the first.
@property(nonatomic, copy, nullable) void (^onClick)(MVRow *row);
@property(nonatomic, readonly, nullable) MVRow *selected;
- (void)scrollToEnd;
- (void)selectKey:(nullable NSString *)key;
/// Where a row stands in its window.
- (NSPoint)pointOfRow:(NSUInteger)at;
/// What a secondary click on a row offers, and the row it was on.
@property(nonatomic, nullable) NSMenu *rowMenu;
@property(nonatomic, readonly, nullable) NSString *clickedKey;
/// With either, rows are matched by key or title, and what comes or goes opens or closes; else a list just shows what it is given.
- (void)useSidebarStyle;
- (void)letRowsArrive;
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

/// Where an element's rectangle stands in a view of this size: the rectangle is from the picture's top left.
NSRect MVMarkFrame(NSDictionary *rect, CGSize size);
/// Text on a pasteboard: a person's is the general one.
void MVCopyText(NSString *text, NSPasteboard *board);

static const double MVInspectorWidth = 320;

/// The system's Inspector of one window. It holds the panes of one device at a time, and tells that device when they show or hide.
@interface MVInspectorSlot : NSObject
@property(nonatomic, readonly) NSSplitViewItem *item;
@property(nonatomic, readonly, nullable) NSView *pane;
- (void)hold:(nullable NSView *)pane onMove:(nullable void (^)(void))onMove;
/// A window under `least` wide goes without it, and has it back when it is wide enough again.
- (void)fitWindow:(double)wide least:(double)least;
/// What stands in it with no device's panes: why, in words.
- (void)sayEmpty:(NSString *)words;
@end

/// A side of a window closes while the window is too narrow for it, and opens again only if that is what closed it.
void MVGiveWay(NSSplitViewItem *item, BOOL narrow, BOOL *gaveWay);

/// Where the chosen stand: one fills it, and two share it evenly. Its window's Inspector goes with it.
@interface MVRoomView : NSView
/// Where a stage stands of two; -1 for one alone.
- (NSInteger)sideOf:(NSView *)stage;
/// What stands behind every stage and place.
@property(nonatomic) MVBackdrop *backdrop;
@property(nonatomic) MVInspectorSlot *slot;
/// The toolbar while no device stands here.
@property(nonatomic) NSToolbar *bare;
/// What the sidebar says of a device.
@property(nonatomic, copy, nullable) NSDictionary *_Nullable (^rowOf)(NSString *serial);
/// What takes the room in place of a device.
@property(nonatomic, nullable) NSView *place;
/// What lies over a device for a moment.
@property(nonatomic, nullable) NSView *note;
@end

typedef NS_ENUM(NSInteger, MVShow) { MVShowBehind,
                                     MVShowFront,
                                     MVShowFocused };

/// A device's controls as the system's own toolbar.
@interface MVToolbar : NSObject <NSToolbarDelegate>
- (instancetype)initWithGroups:(NSArray<NSArray<NSString *> *> *)groups target:(id)target action:(SEL)action;
- (NSToolbar *)toolbar;
/// What stands for a control, for a word on it, or a click.
- (nullable NSButton *)buttonNamed:(NSString *)name;
/// What stands left of the capsule: the device's name, and a line under it. Its controls say the same to a screen reader.
- (void)setName:(NSString *)name about:(nullable NSString *)about;
- (void)hideInspectorSwitch:(BOOL)hidden;
@property(nonatomic, readonly) MVCapsule *capsule;
/// A control's symbol now, in its own ink.
- (void)paint:(NSString *)name symbol:(NSString *)symbol color:(NSColor *)color;
@end

/// All of a device's views: the whole of a window of its own, or what stands in a room of the hub's.
@interface MVRootView : NSView <MVStaged>
/// The device it is, where a process holds more than one.
@property(nonatomic, copy, nullable) NSString *stage;
@property(nonatomic, copy, nullable) void (^onResize)(void);
@end

/// One device's stream and what shows it. A process with one has one stage, with no name.
@interface MVStage : NSObject <MVSink>
- (instancetype)initNamed:(nullable NSString *)name room:(nullable NSView *)room windowless:(BOOL)windowless;
@property(nonatomic) BOOL behind;
@property(nonatomic) BOOL poses;
/// It has gone, in a process that goes on.
@property(nonatomic, copy, nullable) void (^onGone)(void);
- (void)handle:(NSString *)op message:(NSDictionary *)m;
/// A tick needs nothing of the main thread.
- (void)tick:(NSDictionary *)message;
/// This second's numbers, which the parent hears as being this stage's.
- (NSDictionary *)report;
- (void)showReport:(NSDictionary *)report;
@end

/// How a window shows itself. Only a person's `--focus` gives it the keyboard; a click does the rest.
MVShow MVShowOf(BOOL focus, BOOL behind);
void MVPresent(MVOffscreenWindow *window, MVShow how);

/// The sheet that makes a new simulator or emulator, from what the parent says can be made.
/// A system a new device may run, as a person reads it.
NSString *MVSystemName(NSDictionary *row);

@interface MVNewDevice : NSObject
- (void)askIn:(NSWindow *)window kind:(NSString *)kind choices:(NSDictionary *)choices;
- (void)create:(nullable id)sender;
- (void)setName:(NSString *)name;
@end

@class MVPlace;

/// The window of `appdyno hub`: what its parent says is there, and what a person asks of it.
@interface MVHub : NSObject <NSWindowDelegate, NSSearchFieldDelegate>
- (instancetype)initWithShow:(MVShow)how poses:(BOOL)poses;
/// Where the device chosen stands.
@property(nonatomic, readonly) NSView *room;
/// What the parent was told to show.
@property(nonatomic, readonly, nullable) NSString *chosen;
- (void)show:(NSDictionary *)message;
- (void)sayNote:(NSString *)note;
/// How the device chosen is, where no picture of it stands yet.
- (void)showStatus:(NSDictionary *)message;
/// Presses a device's button as a person does.
- (void)poke:(NSDictionary *)message;
- (BOOL)snapshot:(NSString *)file;
- (NSArray<NSDictionary *> *)parts;
@end

@interface MVHub (Rows)
- (void)listDevices;
- (nullable NSDictionary *)rowFor:(NSString *)serial;
- (void)sayWhatMoved;
/// One more place under the devices, last added last.
- (void)addPlace:(MVPlace *)place;
- (void)choosePlace:(MVPlace *)place;
/// The place standing, if one is.
- (nullable NSView *)placeShown;
/// A device comes back into the room: the Inspector it had comes with it.
- (void)leavePlaceFor:(nullable NSDictionary *)device;
/// What the sidebar lists, for a look at it.
- (NSArray<NSString *> *)rowTitles;
- (BOOL)sidebarClosed;
@end

NS_ASSUME_NONNULL_END
