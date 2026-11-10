// The Inspector beside a device and the panes it holds.
#import "Viewer.h"
#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

@class MVRow;

/// A longer look at the readings, and the real measures of the app in front, which the parent runs.
@interface MVPerfPane : NSView
- (instancetype)initWithFrame:(NSRect)frame target:(id)target;
- (void)setPictureRate:(double)rate;
- (void)show:(NSDictionary *)message;
- (void)showMeasuring:(NSString *)line;
- (void)showMeasured:(NSDictionary *)result;
/// What was measured on this device before, newest first, and the name of the app a measure restarts.
- (void)showHistory:(NSDictionary *)message;
/// What the last measure came to, and how a line of the readings stands.
- (NSString *)lastResult;
- (BOOL)lastMarked;
- (NSString *)shownFor:(NSString *)field;
@end

/// Words of a pane, and a heading over them.
NSTextField *MVPaneNote(NSString *text);
NSTextField *MVPaneHeading(NSString *text);

/// What an agent did on this device, as runs of work.
@interface MVActivityPane : NSView
- (void)add:(NSDictionary *)call;
/// The newest line, for a look at what it says, how many lines stand, and where the first is in its window.
- (NSString *)firstLine;
- (NSUInteger)lines;
- (NSPoint)firstLinePoint;
@end

/// What a person's clicks have written, and what is under the pointer, as the parent says.
@interface MVFlowPane : NSView
- (instancetype)initWithFrame:(NSRect)frame target:(id)target;
/// What a click on the device does instead of touching it; nil: it touches.
@property(nonatomic, readonly, nullable) NSString *clickDoes;
/// A person chose what a click does.
@property(nonatomic, copy, nullable) void (^onClick)(void);
/// The window says what the pointer is over.
@property(nonatomic) BOOL looking;
/// A recording runs.
@property(nonatomic) BOOL recording;
- (void)chooseClick:(NSString *)does;
- (void)show:(NSDictionary *)message;
- (void)showElement:(NSDictionary *)message;
/// What it says now.
- (NSString *)recordTitle;
- (NSString *)elementShown;
- (NSArray<MVRow *> *)rows;
@end

/// What an op answered a pane: a line of progress while it runs, then what it did, or why not and what to do.
@interface MVAnswerView : NSStackView
- (void)sending:(NSString *)words;
/// The parent's `answer`: a `line` of progress, or `ok` with its `text` and `hint`.
- (void)show:(NSDictionary *)message;
/// A send has had no answer yet.
@property(nonatomic, readonly) BOOL waiting;
@property(nonatomic, readonly) NSString *said, *hint;
@end

/// A pane that asks the parent for what it shows.
@protocol MVAsks <NSObject>
/// Where what it asks goes; none: to the parent.
@property(nonatomic, copy, nullable) void (^onSend)(NSDictionary *message);
/// The parent's answer, and what the pane lists.
- (void)show:(NSDictionary *)message;
@end

/// A pane that sends to the device by an op an agent calls, and shows what came of it.
@protocol MVSendPane <MVAsks>
/// Its first field takes the keyboard, for a person who asked for the pane.
- (void)focus;
/// What it lists, asked of the parent as it shows.
- (void)ask;
@property(nonatomic, readonly) MVAnswerView *answer;
@end

/// A field of a send pane, by the name a click finds it by: Return sends, and leaving the field does not.
NSTextField *MVSendField(NSString *name, NSString *placeholder, NSString *label, id target, SEL action);
/// The same, unseen as it is typed and never copied out of: for a token.
NSSecureTextField *MVSecretField(NSString *name, NSString *placeholder, NSString *label, id target, SEL action);
/// What a send pane asks: to its `onSend` where a test set one, else to the parent.
void MVPaneSend(NSView<MVAsks> *pane, NSDictionary *message);

/// A link to open on the device by `open_link`, what came of it, the links opened here before and those the app named opens.
@interface MVLinkPane : NSView <MVSendPane>
/// A link in the field, as typed, and the app where one is given.
- (void)fill:(NSString *)url app:(nullable NSString *)app;
@property(nonatomic, readonly) NSArray<MVRow *> *rows;
/// Why the device cannot tell the app's links, where it says so.
@property(nonatomic, readonly) NSString *why;
@end

/// A push to an app by `push`: the types this device takes, the fields of the one chosen or its payload, and what came of it.
@interface MVPushPane : NSView <MVSendPane>
/// For a test: a type chosen and its fields typed, by the op's names.
- (void)fill:(NSDictionary<NSString *, NSString *> *)fields;
@end

/// What a row of the Device pane holds: a switch, a choice, a field, or the controls of what happens once.
typedef NS_ENUM(NSInteger, MVRowKind) { MVRowSwitch,
                                        MVRowChoice,
                                        MVRowField,
                                        MVRowLocation,
                                        MVRowBiometric,
                                        MVRowCall,
                                        MVRowSms };

/// Where a row's controls send what a person does with them.
@protocol MVConditionTarget <NSObject>
- (void)switched:(NSSwitch *)sender;
- (void)chosen:(NSPopUpButton *)sender;
- (void)typed:(NSTextField *)sender;
- (void)pressed:(NSButton *)sender;
@end

/// One row of the Device pane: a condition by the op's name for it, its controls, and what the parent last said of it.
@interface MVConditionRow : NSObject
/// Every row, in the order they stand.
+ (NSArray<MVConditionRow *> *)rowsFor:(id<MVConditionTarget>)target;
@property(nonatomic, readonly, copy) NSString *name, *title;
/// The heading the row opens, where it opens one.
@property(nonatomic, readonly, copy, nullable) NSString *heading;
@property(nonatomic, readonly) MVRowKind kind;
@property(nonatomic, readonly) NSView *view;
@property(nonatomic, readonly, nullable) NSTextField *field, *from;
@property(nonatomic, readonly, nullable) NSControl *control;
@property(nonatomic, copy, nullable) NSDictionary *said;
/// It can be changed, and was changed here, as the parent last said.
@property(nonatomic, readonly) BOOL can, changed;
- (void)offerChoices:(BOOL)android;
- (void)fill;
- (void)enable:(BOOL)on;
/// Its state in a person's words, and for a test in the op's.
@property(nonatomic, readonly) NSString *state, *shown;
/// A change of it is on its way: the row turns a spinner of its own until the answer comes.
@property(nonatomic) BOOL pending;
/// A change the device did not take, in a person's words, under the row until it is changed again.
@property(nonatomic, copy, nullable) NSString *warning;
/// Whether the device reads `value` as the op names it, by the parent's last word; and how a person reads `value`.
- (BOOL)reads:(NSString *)value;
- (NSString *)titleFor:(NSString *)value;
@end

/// The device's conditions as it reads them, each changed by `device_setting`, the op an agent calls, and put back with
/// the rest of what this session changed; what the device cannot do stands disabled, with why.
@interface MVDevicePane : NSView <MVSendPane>
/// For a test: a condition set as a person sets its control, by the op's names; what it shows, or why it cannot.
- (void)set:(NSString *)name to:(NSString *)value;
- (NSString *)shown:(NSString *)name;
@end

/// A pane that reads the device only while it shows: it says so to the parent, as its reads cost the device.
@protocol MVWatches <MVAsks>
/// It shows, as the Inspector says.
@property(nonatomic) BOOL watching;
@end
/// Text to read, select and copy, on a card that scrolls, by the name a click finds it by: a log, a report, a request.
NSTextView *MVReadText(NSString *name, NSString *label, NSView *_Nullable *_Nonnull card);
/// Views one under another, each as wide as the column; and the same filling a pane, edge to edge.
NSStackView *MVPaneStack(NSArray<NSView *> *views, CGFloat spacing);
NSStackView *MVPaneFill(NSView *pane, NSArray<NSView *> *views, CGFloat spacing);
/// Buttons side by side, each as wide as the next, across the pane.
NSStackView *MVPaneRow(NSArray<NSView *> *views);
/// Tells the parent that a pane, by its name, reads the device or has stopped, at a level where it has one.
void MVPaneWatch(NSView<MVAsks> *pane, NSString *name, BOOL on, NSString *_Nullable level);

/// The log of the app in front as `logs` reads it, as it comes, and the app's crash reports as `crashes` gives them.
@interface MVLogPane : NSView <MVWatches>
/// The parent's `crashes`.
- (void)showCrashes:(NSDictionary *)message;
/// What it shows now: its lines as a person reads them, and its crash reports.
@property(nonatomic, readonly) NSArray<NSString *> *shownLines;
@property(nonatomic, readonly) NSArray<MVRow *> *crashRows;
@end

/// The app's requests as `network` gives them, the ways this device has to see them, and what a person needs where none.
@interface MVNetworkPane : NSView <MVWatches>
@property(nonatomic, readonly) MVAnswerView *answer;
@property(nonatomic, readonly) NSArray<MVRow *> *rows;
/// What it says of the capture, and of the request chosen.
@property(nonatomic, readonly) NSString *said, *detail;
@end

/// What `audit` finds on the screen shown, by kind; one chosen is marked on the device's picture.
@interface MVAuditPane : NSView <MVWatches>
/// An issue was chosen, with where it stands on the picture; nil: none.
@property(nonatomic, copy, nullable) void (^onMark)(NSDictionary *_Nullable rect);
/// An issue chosen, by its place in what the parent sent, as a person's click chooses it.
- (void)choose:(NSString *)key;
@property(nonatomic, readonly) NSArray<MVRow *> *rows;
@property(nonatomic, readonly) NSString *said;
@end

/// The panes of the Inspector, by the index `showPane:` takes, in the order their symbols stand.
enum { MVPanePerf,
       MVPaneFlow,
       MVPaneApps,
       MVPaneActivity,
       MVPaneLogs,
       MVPaneNetwork,
       MVPaneAccessibility,
       MVPaneDevice,
       MVPaneLinks,
       MVPanePush,
       MVPanes };

/// What goes in the Inspector: a row of symbols, one to a pane, and the name of the one chosen on a line of its own.
@interface MVInspector : NSView <MVStaged>
- (instancetype)initWithFrame:(NSRect)frame target:(id)target;
/// The device's own views, which name its stage: in the hub the Inspector stands apart from them, in the room's slot.
@property(nonatomic, weak, nullable) id<MVStaged> of;
@property(nonatomic, readonly) MVPerfPane *perf;
@property(nonatomic, readonly) MVFlowPane *flow;
/// The stream's numbers, which stand in no pane of their own.
@property(nonatomic, readonly) NSView *numbers;
@property(nonatomic, readonly) MVActivityPane *activity;
@property(nonatomic, readonly) MVLinkPane *links;
@property(nonatomic, readonly) MVPushPane *push;
@property(nonatomic, readonly) MVDevicePane *device;
@property(nonatomic, readonly) MVLogPane *logs;
@property(nonatomic, readonly) MVNetworkPane *network;
@property(nonatomic, readonly) MVAuditPane *audit;
/// The pane an `answer` is for, by its name.
- (id<MVAsks>)answering:(NSString *)name;
/// Whether it shows at all, as its window says: a pane that reads the device does so only while it shows.
@property(nonatomic) BOOL open;
/// The pane chosen, by the index `showPane:` takes.
@property(nonatomic, readonly) NSInteger chosen;
/// Whether Performance is the pane chosen.
@property(nonatomic, readonly) BOOL readings;
/// Whether Flow is.
@property(nonatomic, readonly) BOOL flowing;
/// A pane was chosen.
@property(nonatomic, copy, nullable) void (^onPane)(void);
- (void)showPane:(NSInteger)pane;
- (void)showStats:(NSDictionary *)stats;
- (void)addActivity:(NSDictionary *)call;
- (void)showApps:(NSDictionary *)message;
/// For a test, as a person: the app's id typed into Filter, and its row clicked where it stands.
- (void)pokeApp:(NSString *)app;
@end

NS_ASSUME_NONNULL_END
