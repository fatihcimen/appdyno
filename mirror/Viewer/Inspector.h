// The Inspector beside a device and the panes it holds.
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

/// A link to open on the device, by the op an agent calls, what came of it, and the links opened here before.
@interface MVLinkPane : NSView
/// Where what it asks goes; none: to the parent.
@property(nonatomic, copy, nullable) void (^onSend)(NSDictionary *message);
/// The parent's answer: a line of progress, what the op did or why not, and the recent links.
- (void)show:(NSDictionary *)message;
/// The field takes the keyboard, for a person who asked for the pane.
- (void)focus;
/// The recent links, asked for once.
- (void)ask;
/// For a test: a link in the field, as typed.
- (void)fill:(NSString *)url;
/// What the answer says now, its hint, and the links listed.
@property(nonatomic, readonly) NSString *said, *hint;
@property(nonatomic, readonly) NSArray<MVRow *> *rows;
@end

/// The panes of the Inspector, by the index `showPane:` takes.
enum { MVPanePerf, MVPaneFlow, MVPaneApps, MVPaneActivity, MVPaneLinks, MVPanes };

/// What goes in the Inspector: Performance, Flows, Apps, Activity and Links, by their symbols and the name of the one chosen.
@interface MVInspector : NSView
- (instancetype)initWithFrame:(NSRect)frame target:(id)target;
@property(nonatomic, readonly) MVPerfPane *perf;
@property(nonatomic, readonly) MVFlowPane *flow;
/// The stream's numbers, which stand in no pane of their own.
@property(nonatomic, readonly) NSView *numbers;
@property(nonatomic, readonly) MVActivityPane *activity;
@property(nonatomic, readonly) MVLinkPane *links;
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
