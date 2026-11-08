// The Inspector beside a device and the panes it holds.
#import <AppKit/AppKit.h>
#import "Viewer.h"

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

/// A pane that sends to the device by an op an agent calls, and shows what came of it.
@protocol MVSendPane <NSObject>
/// Where what it asks goes; none: to the parent.
@property(nonatomic, copy, nullable) void (^onSend)(NSDictionary *message);
/// The parent's answer, and what the pane lists.
- (void)show:(NSDictionary *)message;
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
void MVPaneSend(NSView<MVSendPane> *pane, NSDictionary *message);

/// A link to open on the device by `open_link`, what came of it, the links opened here before and those the app named opens.
@interface MVLinkPane : NSView <MVSendPane>
/// A link in the field, as typed, and the app where one is given.
- (void)fill:(NSString *)url app:(nullable NSString *)app;
@property(nonatomic, readonly) NSArray<MVRow *> *rows;
@end

/// A push to an app by `push`: the types this device takes, the fields of the one chosen or its payload, and what came of it.
@interface MVPushPane : NSView <MVSendPane>
/// For a test: a type chosen and its fields typed, by the op's names.
- (void)fill:(NSDictionary<NSString *, NSString *> *)fields;
@end

/// The panes of the Inspector, by the index `showPane:` takes.
enum { MVPanePerf, MVPaneFlow, MVPaneApps, MVPaneActivity, MVPaneLinks, MVPanePush, MVPanes };

/// What goes in the Inspector: Performance, Flows, Apps, Activity, Links and Push, by their symbols and the name of the one chosen.
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
/// The pane an `answer` is for, by its name.
- (id<MVSendPane>)answering:(NSString *)name;
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
@end

NS_ASSUME_NONNULL_END
