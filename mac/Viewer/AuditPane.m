// The Accessibility pane: what `audit` finds on the screen shown, by kind, read by the parent once a screen has settled
// and never while a recording runs. An issue chosen is marked on the device's picture, as the element under the pointer is.
#import "Place.h"
#import "Window.h"
#import "Words.h"

/// The kinds an audit names, in the order they stand, as a person reads them.
static NSString *const kKinds[][2] = {
    {@"contrast", @"Contrast"},
    {@"imageContrast", @"Image contrast"},
    {@"hitRegion", @"Touch target"},
    {@"sufficientElementDescription", @"Description"},
    {@"elementDetection", @"Element detection"},
    {@"dynamicType", @"Dynamic Type"},
    {@"textClipped", @"Clipped text"},
    {@"trait", @"Traits"},
    {@"duplicateLabel", @"Repeated label"},
};
enum { kKindCount = sizeof kKinds / sizeof kKinds[0] };

/// What the pane says of where an audit stands, by the parent's word for it.
static NSString *stateWords(NSDictionary *m, NSUInteger issues) {
  NSString *state = [m[@"state"] description] ?: @"";
  // why it failed names what the device named as it did
  if ([state isEqual:@"failed"]) return MVSentence([m[@"why"] description] ?: @"");
  if (![state isEqual:@"done"]) {
    NSDictionary *said = @{@"waiting": @"Waiting for the screen to settle", @"reading": @"Auditing the screen shown", @"recording": @"Not read while recording", @"held": @"Waits for the picture, and for a measure to end"};
    return MVWord(said[state] ?: @"");
  }
  if (!issues) return MVWord(@"No issue on this screen");
  if ([m[@"truncated"] boolValue]) return MVWord([NSString stringWithFormat:@"The first %lu issues on this screen", (unsigned long)issues]);
  return MVWord(issues == 1 ? @"1 issue on this screen" : [NSString stringWithFormat:@"%lu issues on this screen", (unsigned long)issues]);
}

@implementation MVAuditPane {
  NSTextField *_state;
  NSButton *_again;
  MVList *_list;
  NSView *_none;
  NSArray<NSDictionary *> *_issues;
  BOOL _marked;
}

@synthesize onSend = _onSend, watching = _watching;

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _issues = @[];
    _state = MVPaneNote(@"Waiting for the screen to settle");
    _state.maximumNumberOfLines = 0;
    MVHoldContent(_state);
    [_state setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
    _again = MVPlaceButton(@"Check Again", @"auditAgain", self, @selector(again:));
    _again.toolTip = MVWord(@"Audits the screen shown once more");
    NSStackView *head = [NSStackView stackViewWithViews:@[_state, _again]];
    head.spacing = 8;
    _none = MVEmptyCard(@"checkmark.circle", @"Nothing found on this screen.");
    _none.hidden = YES;
    _list = [MVList new];
    _list.accessibilityLabel = MVWord(@"Accessibility issues");
    [_list setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationVertical];
    __weak MVAuditPane *weak = self;
    _list.onSelect = ^(MVRow *row) {
      [weak mark:row.key];
    };
    MVPaneFill(self, @[head, _none, _list], 10);
  }
  return self;
}

/// A mark stays on the picture only while the pane shows.
- (void)setWatching:(BOOL)watching {
  if (watching == _watching) return;
  _watching = watching;
  MVPaneWatch(self, @"accessibility", watching, nil);
  if (!watching) [self mark:nil];
}

- (void)choose:(NSString *)key {
  [_list selectKey:key];
}

- (void)again:(id)sender {
  MVPaneSend(self, @{@"op": @"control", @"name": @"auditAgain"});
}

/// The issue chosen, marked where it stands on the picture; one with no place, or none, takes the mark away.
- (void)mark:(nullable NSString *)key {
  NSDictionary *issue = key && key.integerValue < (NSInteger)_issues.count ? _issues[key.integerValue] : nil;
  NSDictionary *rect = [issue[@"rect"] isKindOfClass:NSDictionary.class] ? issue[@"rect"] : nil;
  if (!rect && !_marked) return;
  _marked = rect != nil;
  if (!key) [_list selectKey:nil];
  if (self.onMark) self.onMark(rect);
}

/// The issues of one kind, under a heading that counts them.
- (void)addKind:(NSString *)kind named:(NSString *)name to:(NSMutableArray<MVRow *> *)rows {
  NSMutableArray<MVRow *> *found = [NSMutableArray array];
  [_issues enumerateObjectsUsingBlock:^(NSDictionary *issue, NSUInteger at, __unused BOOL *stop) {
    if (![issue[@"type"] isEqual:kind]) return;
    MVRow *row = [MVRow new];
    // an audit's words are said, and what it quotes of the app, such as a label read twice, kept
    row.title = MVSentence([issue[@"message"] description] ?: @"");
    // the element's own words, not the rule that found it, which is an engine's name; the whole message under the pointer
    row.detail = [issue[@"label"] length] ? issue[@"label"] : @"";
    row.help = row.title;
    row.symbol = issue[@"rect"] ? @"scope" : @"exclamationmark.triangle";
    row.tint = MVOrange();
    row.key = @(at).stringValue;
    [found addObject:row];
  }];
  if (!found.count) return;
  [rows addObject:[MVRow headerNamed:[NSString stringWithFormat:@"%@ · %lu", MVWord(name), (unsigned long)found.count]]];
  [rows addObjectsFromArray:found];
}

/// The parent's `audit`: where it stands, and what it found once done.
- (void)show:(NSDictionary *)m {
  NSString *state = [m[@"state"] description] ?: @"";
  // what was found stands until the next audit begins: it is of a screen that may be gone
  BOOL found = [@[@"done", @"failed", @"reading"] containsObject:state];
  if (found) {
    [self mark:nil];
    _issues = [m[@"issues"] isKindOfClass:NSArray.class] ? m[@"issues"] : @[];
    NSMutableArray<MVRow *> *rows = [NSMutableArray array];
    NSMutableSet<NSString *> *known = [NSMutableSet set];
    for (NSInteger i = 0; i < kKindCount; i++) {
      [known addObject:kKinds[i][0]];
      [self addKind:kKinds[i][0] named:kKinds[i][1] to:rows];
    }
    for (NSDictionary *issue in _issues)
      if (![known containsObject:[issue[@"type"] description] ?: @""]) {
        [known addObject:[issue[@"type"] description] ?: @""];
        [self addKind:issue[@"type"] named:issue[@"type"] to:rows];
      }
    _list.rows = rows;
  }
  _state.stringValue = stateWords(m, _issues.count);
  _again.enabled = ![state isEqual:@"reading"];
  _list.hidden = !_list.rows.count;
  _none.hidden = !_list.hidden || ![state isEqual:@"done"];
}

- (NSArray<MVRow *> *)rows {
  return _list.rows;
}

- (NSString *)said {
  return _state.stringValue;
}

@end
