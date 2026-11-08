// What the hub's places are made of: AI Clients and Help, which take the room and hold no device.
#import "Style.h"
#import "Window.h"
#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

@class MVToolsPane;

/// A capsule, in a colour of its own in any window. The one a person came for has the accent's gradient; `quiet` makes it like
/// the rest, and `hue` gives a quiet one its part's colour.
@interface MVAccentButton : MVBarButton
@property(nonatomic) BOOL quiet;
@property(nonatomic, nullable) NSColor *hue;
@end

/// A list that ticks itself, on one line from what is done to what is later. An item has `title`, `state` (`done`, `now` or
/// `later`), and may have a control at its `end`.
@interface MVStepper : NSStackView
- (void)showItems:(NSArray<NSDictionary *> *)items;
@end
MVStepper *MVNewStepper(void);

/// A colour darkened only as far as white words on it need, for this window's look.
NSColor *MVFillFor(NSColor *color);
/// A tinted square with a symbol, as a part of a page wears it.
NSView *MVTile(NSString *symbol, NSColor *color, CGFloat side);
/// The same with a letter, for what has a name and no symbol.
NSView *MVLetterTile(NSString *letter, NSColor *color, CGFloat side);
/// A word of how something stands, in a capsule, with its symbol.
NSView *MVChip(NSString *symbol, NSString *words, NSColor *color);
void MVChipSay(NSView *chip, NSString *words);
/// The accent's own gradient, behind a picture.
NSView *MVWash(void);
/// What a place is, at the head of its page.
NSView *MVPlaceHead(NSString *symbol, NSColor *color, NSString *title, NSString *sentence);
/// A new view arrives: a fade, and a short slide for a person who has not asked for less motion.
void MVSlideIn(NSView *view, double from);

/// A place of the sidebar that is no device: chosen, it takes the room.
@interface MVPlace : NSObject
@property(nonatomic, copy) NSString *title;
@property(nonatomic, copy) NSString *symbol;
@property(nonatomic) NSView *view;
@end

/// AI Clients and Help, each a place of the hub.
@interface MVHub (Places)
- (void)addOwnPlaces;
/// Where nothing stands, Connect a Phone does, by itself.
- (void)offerConnect;
/// A phone listed by now that got ready, and what to try on it.
- (void)openWaiting;
- (void)leaveNote;
@property(nonatomic, readonly) MVToolsPane *toolsPane;
/// What the parent says of clients.
- (void)showClients:(NSDictionary *)message;
- (void)openHelp:(nullable id)sender;
- (void)pokeClick:(NSString *)name;
- (void)pokeRow:(NSString *)title;
- (void)pokeBoard;
@end

/// Opens a page or a file outside this window, as a person's click asks; a window kept behind only notes it.
void MVOpenOutside(NSString *where);
NSString *_Nullable MVLastOpened(void);

/// A page of one column, as wide as it reads well, that scrolls in what room it has.
NSScrollView *MVPlacePage(NSView *column);
/// Words that wrap to the page, to as many lines as they take.
NSTextField *MVParagraph(NSString *text, MVStyle style);
/// Words of a client, where what stands in backticks is a thing to type.
NSTextField *MVNoteText(NSString *text);
/// A column of views, each as wide as the column.
NSStackView *MVPlaceColumn(NSArray<NSView *> *views, CGFloat spacing);
/// A control of a place, by the name a real click finds it by; it answers the first click, as this window is seldom the key one.
NSButton *MVPlaceButton(NSString *title, NSString *name, id target, SEL action);
/// The one button of a row or card a person came for.
MVAccentButton *MVPlacePrimary(NSString *title, NSString *name, id target, SEL action);
/// A quiet ground for what belongs together, `tall` above and below what it holds: no glass, as that is for controls.
NSView *MVCard(NSView *content, CGFloat tall);
/// The same, with `wide` at its sides.
NSView *MVCardInset(NSView *content, CGFloat tall, CGFloat wide);
/// What belongs to the row above it.
NSView *MVIndented(NSView *view, CGFloat left);
/// What lies over a device for a moment, on a solid ground of its own.
@interface MVNoteView : NSView
@end
NSView *MVNote(NSView *content);
/// Words that take the room they have, with what is pressed at the row's end.
NSView *MVPlaceRow(NSView *words, NSArray<NSView *> *ends);
/// A line between the rows of a card.
NSView *MVSeparator(void);
/// A field on a card, on a plate of the palette's: the system's bezel is a black slab on a dark card.
NSView *MVFieldPlate(NSTextField *field, NSView *_Nullable end);
/// Nothing here yet: a symbol and what would come, on a card.
NSView *MVEmptyCard(NSString *symbol, NSString *words);
/// A word to the parent, for AI Clients and Help alike.
void MVAskClients(NSString *what, NSDictionary *more);
/// A self test hears those words itself, as it has no parent.
void MVTapAsks(void (^_Nullable tap)(NSDictionary *message));
/// The app last named as in front of a device: a place stands where no device does, and a prompt still needs its name.
void MVNoteFrontApp(NSString *name);
NSString *_Nullable MVFrontApp(void);
/// Text as it is typed or stored, to be read exactly and selected.
NSTextField *MVCodeText(NSString *text);
/// Where a copy goes: nowhere a person would meet it, for a window kept behind for a test.
NSPasteboard *MVPlaceBoard(void);
void MVPlaceBehind(BOOL behind);
BOOL MVPlaceIsBehind(void);
/// Says on a button that its copy was made, for a moment and to a screen reader too.
void MVSayCopied(NSButton *button);
/// The hub's two languages, as the parent sends a client's own words.
NSString *MVSaid(NSDictionary *said);

/// AI Clients: every client in the list, how it truly stands, and what a person can do about it.
@interface MVClientsPane : NSView
/// All the parent says of clients, whole or a part at a time.
- (void)show:(NSDictionary *)message;
/// The clients the parent says have a note on a kind of prompt, for Help.
@property(nonatomic, readonly) NSArray<NSDictionary *> *notes;
@property(nonatomic, copy, nullable) void (^onNotes)(NSArray<NSDictionary *> *notes);
@property(nonatomic, copy, nullable) void (^onDoctor)(NSArray<NSDictionary *> *checks);
@end

/// Help: what appdyno is, what to ask of an AI client, what every word means, and what to do when something fails.
@interface MVHelpPane : NSView
/// The prompts' device and app; nil for each that is not known.
- (void)fillDevice:(nullable NSDictionary *)device app:(nullable NSString *)app;
- (void)showNotes:(NSArray<NSDictionary *> *)notes;
- (void)showDoctor:(NSArray<NSDictionary *> *)checks;
@end

/// A step's picture: a plain phone and what to do on it, drawn here.
@interface MVStepPicture : NSView
@property(nonatomic, copy, nullable) NSString *step;
@end

/// Connect a Phone's card for going without a cable: once for each phone, by what `appdyno pair` does.
@interface MVWifiCard : NSObject
@property(nonatomic, readonly) NSView *view;
- (void)show:(NSDictionary *)guide;
- (void)heard:(NSDictionary *)run;
@end

/// Connect a Phone: the phone's current step, moved on by what the parent reads of it.
@interface MVConnectPane : NSView
- (void)show:(NSDictionary *)guide;
- (void)heard:(NSDictionary *)run;
@property(nonatomic) BOOL hasDevice;
/// A phone seen unready here got ready.
@property(nonatomic, copy, nullable) void (^onReady)(NSString *serial);
/// A person pressed Open.
@property(nonatomic, copy, nullable) void (^onOpen)(NSString *serial);
@property(nonatomic, copy, nullable) void (^onNew)(NSString *kind);
@property(nonatomic, copy, nullable) void (^onPlace)(NSString *title);
@end

/// One row of Tools, with what came of it last.
@interface MVToolRow : NSObject
- (instancetype)initWithAbout:(NSArray<NSString *> *)about hue:(NSInteger)hue owner:(id)owner run:(SEL)run open:(SEL)open;
@property(nonatomic, readonly) NSView *view;
@property(nonatomic, readonly) MVAccentButton *button;
@property(nonatomic, readonly, copy) NSString *needs, *verb;
@property(nonatomic, copy, nullable) NSString *running, *file;
/// Its button now does what its preview showed.
@property(nonatomic) BOOL armed;
/// What it lacks, in a word: it cannot run, and says so where its button stands.
- (void)needs:(nullable NSString *)lack;
- (void)began:(NSDictionary *)run device:(nullable NSString *)device;
- (void)heardText:(NSString *)text;
- (void)ended:(NSDictionary *)run;
- (void)armAs:(NSString *)title;
@end

/// Tools: what appdyno does at a terminal, from the window.
@interface MVToolsPane : NSView
- (void)heard:(NSDictionary *)run;
- (void)showApps:(NSDictionary *)message;
- (void)fillDevice:(nullable NSDictionary *)device;
/// For a test: what a person would pick.
- (void)chooseApp:(NSString *)app folder:(NSString *)folder;
@end

NS_ASSUME_NONNULL_END
