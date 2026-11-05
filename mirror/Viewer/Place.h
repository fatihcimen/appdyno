// What the hub's places are made of: AI Clients and Help, which take the room and hold no device.
#import <AppKit/AppKit.h>
#import "Style.h"
#import "Window.h"

NS_ASSUME_NONNULL_BEGIN

/// A place of the sidebar that is no device: chosen, it takes the room.
@interface MVPlace : NSObject
@property(nonatomic, copy) NSString *title;
@property(nonatomic, copy) NSString *symbol;
@property(nonatomic) NSView *view;
@end

/// AI Clients and Help, each a place of the hub.
@interface MVHub (Places)
- (void)addOwnPlaces;
/// What the parent says of clients.
- (void)showClients:(NSDictionary *)message;
- (void)openHelp:(nullable id)sender;
- (void)pokeClick:(NSString *)name;
- (void)pokeRow:(NSString *)title;
- (void)pokeBoard;
@end

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
NSButton *MVPlacePrimary(NSString *title, NSString *name, id target, SEL action);
/// A quiet ground for what belongs together, `tall` above and below what it holds: no glass, as that is for controls.
NSView *MVCard(NSView *content, CGFloat tall);
/// What belongs to the row above it.
NSView *MVIndented(NSView *view, CGFloat left);
/// A line between the rows of a card.
NSView *MVSeparator(void);
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

NS_ASSUME_NONNULL_END
