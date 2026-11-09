// The Logs pane: the log of the app in front as `logs` reads it, as it comes, and the app's crash reports as `crashes`
// gives them. The parent reads only while the pane shows and is not paused; Clear empties this view, never the device's log.
#import "Place.h"
#import "Window.h"
#import "Words.h"

enum { kKeep = 2000,
       kSpare = 500,
       kLevelCount = 5,
       kInfo = 2 };
static const double kLogFont = 10.5, kCrashList = 150, kTextInset = 4;

/// The levels a person chooses from, by what `logs` takes and what a person reads.
static NSString *const kLevels[kLevelCount][2] = {{@"verbose", @"Verbose"}, {@"debug", @"Debug"}, {@"info", @"Info"}, {@"warn", @"Warnings"}, {@"error", @"Errors"}};

/// Text to read, select and copy, on a card that scrolls: a log's lines, or a crash report.
NSTextView *MVReadText(NSString *name, NSString *label, NSView *_Nullable *_Nonnull card) {
  NSScrollView *scroll = [NSTextView scrollableTextView];
  NSTextView *text = scroll.documentView;
  text.identifier = name;
  text.accessibilityLabel = MVWord(label);
  text.editable = NO;
  text.selectable = YES;
  text.drawsBackground = NO;
  text.font = [NSFont monospacedSystemFontOfSize:kLogFont weight:NSFontWeightRegular];
  text.textColor = MVInkColor();
  text.textContainerInset = NSMakeSize(kTextInset, kTextInset);
  scroll.drawsBackground = NO;
  scroll.autohidesScrollers = YES;
  *card = MVCardInset(scroll, 2, 2);
  return text;
}

@implementation MVLogPane {
  NSArray<MVAccentButton *> *_sections;
  NSView *_logPart, *_crashPart;
  NSPopUpButton *_level;
  NSSearchField *_search;
  NSButton *_pause, *_copy;
  NSTextField *_about, *_crashNote;
  NSTextView *_text, *_report;
  MVList *_crashes;
  NSMutableArray<NSDictionary *> *_lines, *_held;
  NSArray<NSDictionary *> *_reports;
  NSString *_app, *_note, *_said;
  BOOL _paused;
}

@synthesize onSend = _onSend, watching = _watching;

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _lines = [NSMutableArray array];
    _held = [NSMutableArray array];
    // capsules as Flows has them, which hold their strength in a window behind others, as a segmented control does not
    _sections = @[(MVAccentButton *)MVPlaceButton(@"Log", @"logShowLog", self, @selector(sectionChosen:)), (MVAccentButton *)MVPlaceButton(@"Crashes", @"logShowCrashes", self, @selector(sectionChosen:))];
    _sections[1].tag = 1;
    NSStackView *sections = MVPaneRow(_sections);
    _logPart = [self logPart];
    _crashPart = [self crashPart];
    MVPaneFill(self, @[sections, _logPart, _crashPart], 10);
    [self showSection:NO];
  }
  return self;
}

- (NSView *)logPart {
  _level = [NSPopUpButton new];
  for (int i = 0; i < kLevelCount; i++) [_level addItemWithTitle:MVWord(kLevels[i][1])];
  [_level selectItemAtIndex:kInfo];
  _level.identifier = @"logLevel";
  _level.accessibilityLabel = MVWord(@"Lowest level shown");
  _level.target = self;
  _level.action = @selector(levelChosen:);
  [_level setContentHuggingPriority:NSLayoutPriorityRequired forOrientation:NSLayoutConstraintOrientationHorizontal];
  _search = [NSSearchField new];
  _search.identifier = @"logSearch";
  _search.placeholderString = MVWord(@"Search");
  _search.accessibilityLabel = MVWord(@"Search the log");
  _search.target = self;
  _search.action = @selector(searched:);
  NSStackView *find = [NSStackView stackViewWithViews:@[_level, _search]];
  find.spacing = 8;
  _pause = MVPlaceButton(@"Pause", @"logPause", self, @selector(pause:));
  _copy = MVPlaceButton(@"Copy", @"logCopy", self, @selector(copyLines:));
  _copy.toolTip = MVWord(@"Copies the lines chosen, or all that show");
  NSButton *clear = MVPlaceButton(@"Clear", @"logClear", self, @selector(clear:));
  clear.toolTip = MVWord(@"Empties this view: the device keeps its log");
  NSStackView *buttons = MVPaneRow(@[_pause, _copy, clear]);
  _about = MVPaneNote(@"");
  _about.maximumNumberOfLines = 0;
  _about.hidden = YES;
  MVHoldContent(_about);
  NSView *card;
  _text = MVReadText(@"logText", @"The app's log", &card);
  NSStackView *part = MVPaneStack(@[find, buttons, _about, card], 8);
  [card setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationVertical];
  return part;
}

- (NSView *)crashPart {
  _crashNote = MVPaneNote(@"");
  _crashNote.maximumNumberOfLines = 0;
  MVHoldContent(_crashNote);
  _crashes = [MVList new];
  _crashes.accessibilityLabel = MVWord(@"Crash reports");
  [_crashes.heightAnchor constraintEqualToConstant:kCrashList].active = YES;
  __weak MVLogPane *weak = self;
  _crashes.onSelect = ^(MVRow *row) {
    [weak showReport:row.key];
  };
  NSView *card;
  _report = MVReadText(@"crashText", @"The crash report", &card);
  NSStackView *part = MVPaneStack(@[_crashNote, _crashes, card], 8);
  [card setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationVertical];
  return part;
}

/// What the parent reads: the log while the pane shows and runs, at the level chosen; told once for each change.
- (void)say {
  BOOL on = _watching && !_paused;
  NSString *level = kLevels[MAX(0, _level.indexOfSelectedItem)][0];
  NSString *now = on ? level : nil;
  if (now == _said || [now isEqual:_said]) return;
  // a pane never shown has nothing to stop
  BOOL told = _said != nil || on;
  _said = now;
  if (told) MVPaneWatch(self, @"logs", on, level);
}

- (void)setWatching:(BOOL)watching {
  _watching = watching;
  [self say];
}

- (void)sectionChosen:(NSButton *)sender {
  [self showSection:sender.tag == 1];
}

/// The log, or the crash reports, the first `crashes` lists open to its text.
- (void)showSection:(BOOL)crashes {
  for (MVAccentButton *section in _sections) {
    BOOL chosen = (section.tag == 1) == crashes;
    section.hue = chosen ? MVAccent() : nil;
    section.accessibilityValue = chosen ? MVWord(@"selected") : nil;
  }
  _logPart.hidden = crashes;
  _crashPart.hidden = !crashes;
  if (crashes && !_crashes.selected && _crashes.rows.count) [_crashes selectKey:_crashes.rows.firstObject.key];
}

- (void)levelChosen:(id)sender {
  [self say];
}

- (void)searched:(id)sender {
  [self render];
}

/// A pause holds what comes, and the parent stops reading; a resume shows what was held and reads on from there.
- (void)pause:(id)sender {
  _paused = !_paused;
  _pause.title = MVWord(_paused ? @"Resume" : @"Pause");
  if (!_paused) {
    NSArray *held = [_held copy];
    [_held removeAllObjects];
    [self append:held];
  }
  [self say];
}

/// This view only: the device's log is the device's, and nothing here asks it to clear.
- (void)clear:(id)sender {
  [_lines removeAllObjects];
  [_held removeAllObjects];
  [self render];
}

/// The whole lines a selection touches, else every line that shows.
- (void)copyLines:(id)sender {
  NSString *all = _text.string;
  NSRange chosen = _text.selectedRange;
  NSString *text = chosen.length ? [all substringWithRange:[all lineRangeForRange:chosen]] : all;
  if (!text.length) return;
  MVCopyText(text, MVPlaceBoard());
  MVSayCopied(_copy);
}

- (BOOL)passes:(NSDictionary *)line {
  NSString *needle = _search.stringValue;
  return !needle.length || [line[@"text"] localizedCaseInsensitiveContainsString:needle];
}

/// A line as it reads, a warning and an error in their colours: the line itself names its level too.
- (NSAttributedString *)textOf:(NSDictionary *)line {
  NSColor *ink = MVInkColor();
  if ([line[@"level"] isEqual:@"error"]) ink = MVRed();
  if ([line[@"level"] isEqual:@"warn"]) ink = MVOrange();
  NSString *text = [line[@"text"] isKindOfClass:NSString.class] ? line[@"text"] : @"";
  return [[NSAttributedString alloc] initWithString:[text stringByAppendingString:@"\n"]
                                         attributes:@{NSFontAttributeName: [NSFont monospacedSystemFontOfSize:kLogFont weight:NSFontWeightRegular], NSForegroundColorAttributeName: ink}];
}

- (void)render {
  NSMutableAttributedString *all = [NSMutableAttributedString new];
  for (NSDictionary *line in _lines)
    if ([self passes:line]) [all appendAttributedString:[self textOf:line]];
  [_text.textStorage setAttributedString:all];
  [_text scrollToEndOfDocument:nil];
}

/// New lines at the end, followed there unless a person scrolled up to read; the oldest go past what is kept.
- (void)append:(NSArray *)lines {
  NSMutableAttributedString *more = [NSMutableAttributedString new];
  for (NSDictionary *line in lines) {
    if (![line isKindOfClass:NSDictionary.class]) continue;
    [_lines addObject:line];
    if ([self passes:line]) [more appendAttributedString:[self textOf:line]];
  }
  if (_lines.count > kKeep + kSpare) {
    [_lines removeObjectsInRange:NSMakeRange(0, _lines.count - kKeep)];
    return [self render];
  }
  if (!more.length) return;
  BOOL atEnd = NSMaxY(_text.visibleRect) >= NSMaxY(_text.bounds) - kLogFont;
  [_text.textStorage appendAttributedString:more];
  if (atEnd) [_text scrollToEndOfDocument:nil];
}

/// The parent's `logs`: lines as they come, a new start for another app or level, and what it cannot read.
- (void)show:(NSDictionary *)m {
  if ([m[@"reset"] boolValue]) {
    _app = [m[@"app"] isKindOfClass:NSString.class] ? m[@"app"] : nil;
    [_lines removeAllObjects];
    [_held removeAllObjects];
    [self render];
  }
  if ([m[@"note"] isKindOfClass:NSString.class]) _note = m[@"note"];
  // the app's name, and what a device says of its log, keep its words as they are
  NSString *about = _app.length ? MVFormat(@"The log of %@, as it comes", @[_app]) : @"";
  _about.stringValue = _note.length ? MVSentence(_note) : about;
  _about.hidden = !_about.stringValue.length;
  NSArray *lines = [m[@"lines"] isKindOfClass:NSArray.class] ? m[@"lines"] : @[];
  if (_paused) [_held addObjectsFromArray:lines];
  else [self append:lines];
}

- (void)showCrashes:(NSDictionary *)m {
  _reports = [m[@"reports"] isKindOfClass:NSArray.class] ? m[@"reports"] : @[];
  NSMutableArray<MVRow *> *rows = [NSMutableArray array];
  [_reports enumerateObjectsUsingBlock:^(NSDictionary *report, NSUInteger at, __unused BOOL *stop) {
    MVRow *row = [MVRow new];
    row.title = [report[@"reason"] description] ?: @"";
    row.detail = [report[@"at"] description] ?: @"";
    row.symbol = @"exclamationmark.octagon";
    row.tint = MVRed();
    row.key = [NSString stringWithFormat:@"%lu", (unsigned long)at];
    [rows addObject:row];
  }];
  _crashes.rows = rows;
  NSString *note = [m[@"note"] isKindOfClass:NSString.class] ? m[@"note"] : @"";
  // one report stands open: a list with reports needs no word of its own
  if (!note.length && !rows.count) note = @"No crash reports of this app.";
  _crashNote.stringValue = MVSentence(note);
  _crashNote.hidden = !note.length;
  NSString *label = rows.count ? [NSString stringWithFormat:@"Crashes: %lu", (unsigned long)rows.count] : @"Crashes";
  _sections[1].title = MVWord(label);
  [self showReport:nil];
}

/// A report chosen: what `crashes` says of it, and where the whole of it is on this Mac.
- (void)showReport:(nullable NSString *)key {
  NSDictionary *report = key && key.integerValue < (NSInteger)_reports.count ? _reports[key.integerValue] : nil;
  NSMutableArray<NSString *> *parts = [NSMutableArray array];
  for (NSString *field in @[@"reason", @"at", @"detail"])
    if ([report[field] length]) [parts addObject:report[field]];
  if ([report[@"file"] length]) [parts addObject:MVFormat(@"The whole report: %@", @[report[@"file"]])];
  if ([report[@"symbolicated"] length]) [parts addObject:MVFormat(@"Named by its symbols: %@", @[report[@"symbolicated"]])];
  _report.string = [parts componentsJoinedByString:@"\n\n"];
  _report.textColor = MVInkColor();
}

- (NSArray<NSString *> *)shownLines {
  NSString *all = _text.string;
  return all.length ? [[all substringToIndex:all.length - 1] componentsSeparatedByString:@"\n"] : @[];
}

- (NSArray<MVRow *> *)crashRows {
  return _crashes.rows;
}

@end
