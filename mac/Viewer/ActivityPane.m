// What an agent did on a device, as a person would tell it: runs of work, each one line, opening to what was done. Calls
// close together are one run; the newest stands first and open, as it is what a person came to see.
#import "Place.h"
#import "Window.h"
#import "Words.h"

enum { kCallsKept = 200 };
static const double kQuietMs = 20000, kMinuteMs = 60000;

@interface MVRun : NSObject
@property(nonatomic) NSMutableArray<NSDictionary *> *calls;
@property(nonatomic) double from, to;
/// All it made, its oldest calls gone too.
@property(nonatomic) NSUInteger made;
@property(nonatomic) BOOL open;
@end

@implementation MVRun
@end

static NSString *tookWords(MVRun *run) {
  double ms = run.to - run.from;
  NSString *took = ms >= kMinuteMs ? [NSString stringWithFormat:@"Worked for %.0f min", ms / kMinuteMs] : [NSString stringWithFormat:@"Worked for %.0f s", MAX(ms / 1000, 1)];
  return [NSString stringWithFormat:@"%@ · %@", took, run.made == 1 ? @"1 call" : [NSString stringWithFormat:@"%lu calls", (unsigned long)run.made]];
}

static MVRow *rowOfCall(NSDictionary *call) {
  BOOL ok = [call[@"ok"] boolValue];
  MVRow *row = [MVRow new];
  // what was done names what it touched as the app does: `Tapped Settings` keeps its Settings
  row.title = [call[@"done"] length] ? MVSentence(call[@"done"]) : MVWord([[call[@"tool"] ?: @"" stringByReplacingOccurrencesOfString:@"_" withString:@" "] capitalizedString]);
  row.detail = [NSString stringWithFormat:@"%@ · %@ ms", call[@"time"] ?: @"", call[@"ms"] ?: @0];
  row.help = call[@"args"];
  // only what failed gets a mark: a run of ticks says nothing
  row.symbol = ok ? nil : @"xmark.octagon.fill";
  row.tint = MVRed();
  return row;
}

@implementation MVActivityPane {
  MVList *_list;
  NSView *_none;
  NSMutableArray<MVRun *> *_runs;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _runs = [NSMutableArray array];
    _none = MVEmptyCard(@"sparkles", @"Nothing yet. What an AI client does on this device is told here.");
    _list = [MVList new];
    __weak MVActivityPane *weak = self;
    _list.onClick = ^(MVRow *row) {
      [weak chose:row];
    };
    NSStackView *stack = [NSStackView stackViewWithViews:@[_none, _list]];
    stack.orientation = NSUserInterfaceLayoutOrientationVertical;
    stack.alignment = NSLayoutAttributeLeading;
    stack.translatesAutoresizingMaskIntoConstraints = NO;
    [self addSubview:stack];
    [NSLayoutConstraint activateConstraints:@[
      [stack.topAnchor constraintEqualToAnchor:self.topAnchor],
      [stack.leadingAnchor constraintEqualToAnchor:self.leadingAnchor],
      [stack.trailingAnchor constraintEqualToAnchor:self.trailingAnchor],
      [stack.bottomAnchor constraintEqualToAnchor:self.bottomAnchor],
      [_list.widthAnchor constraintEqualToAnchor:stack.widthAnchor],
      [_none.widthAnchor constraintEqualToAnchor:stack.widthAnchor],
    ]];
    [self listRuns];
  }
  return self;
}

- (void)chose:(nullable MVRow *)row {
  if (![row.key hasPrefix:@"run"]) return;
  MVRun *run = _runs[[row.key substringFromIndex:3].integerValue];
  run.open = !run.open;
  [self listRuns];
}

- (void)listRuns {
  NSMutableArray<MVRow *> *rows = [NSMutableArray array];
  [_runs enumerateObjectsWithOptions:NSEnumerationReverse
                          usingBlock:^(MVRun *run, NSUInteger at, __unused BOOL *stop) {
                            MVRow *head = [MVRow new];
                            head.title = MVWord(tookWords(run));
                            head.detail = run.calls.firstObject[@"time"] ?: @"";
                            head.symbol = run.open ? @"chevron.down" : @"chevron.right";
                            head.key = [NSString stringWithFormat:@"run%lu", (unsigned long)at];
                            [rows addObject:head];
                            if (!run.open) return;
                            for (NSDictionary *call in run.calls.reverseObjectEnumerator) [rows addObject:rowOfCall(call)];
                          }];
  _list.rows = rows;
  _none.hidden = rows.count > 0;
  _list.hidden = !_none.hidden;
}

- (void)add:(NSDictionary *)call {
  double at = [call[@"at"] doubleValue];
  MVRun *last = _runs.lastObject;
  if (!last || at - last.to > kQuietMs) {
    last.open = NO;
    last = [MVRun new];
    last.calls = [NSMutableArray array];
    last.from = at;
    last.open = YES;
    [_runs addObject:last];
  }
  last.to = at;
  last.made++;
  [last.calls addObject:call];
  // a run that never pauses for long is one run for hours: its oldest calls go, as older runs do
  if (last.calls.count > kCallsKept) [last.calls removeObjectsInRange:NSMakeRange(0, last.calls.count - kCallsKept)];
  NSUInteger kept = 0;
  for (MVRun *run in _runs) kept += run.calls.count;
  if (kept > kCallsKept && _runs.count > 1) [_runs removeObjectAtIndex:0];
  [self listRuns];
}

- (NSUInteger)lines {
  return _list.rows.count;
}

- (NSPoint)firstLinePoint {
  return [_list pointOfRow:0];
}

- (NSString *)firstLine {
  return _list.rows.firstObject.title ?: @"";
}

@end
