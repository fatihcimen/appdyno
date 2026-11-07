// One row of Tools: what it does, and once it has run, what came of it in a person's words, with its device, how long it
// took and its page. What the command said in full stays behind Show Details, as it is full of ids and paths.
#import "Place.h"
#import "Words.h"

static const NSUInteger kLinesShown = 10;
static const double kRowLeast = 40, kRowInset = 7, kShowSeconds = 0.2, kTileSide = 30, kEndGrows = 1.35;

/// A row's own mark.
static NSString *symbolOf(NSString *name) {
  NSDictionary *symbols = @{@"baseline": @"flag", @"compare": @"arrow.left.arrow.right", @"why": @"magnifyingglass", @"survey": @"square.stack.3d.up", @"flows": @"play", @"timeline": @"film", @"flight": @"clock.arrow.circlepath", @"dashboard": @"chart.bar.doc.horizontal", @"tools": @"arrow.down.circle", @"clients-preview": @"sparkles", @"update-check": @"arrow.clockwise", @"update": @"arrow.up.circle", @"path-on": @"terminal", @"path-off": @"terminal"};
  return symbols[name] ?: @"gearshape";
}

/// What a command came to, in a sentence. The gate's own word comes first: an exit code cannot tell a regression from what it
/// could not judge.
static NSString *sentenceOf(NSDictionary *run) {
  int code = [run[@"code"] intValue];
  NSString *name = run[@"name"], *verdict = run[@"verdict"];
  if ([run[@"stopped"] boolValue]) return [name isEqual:@"flight"] ? @"Stopped, and what it held is saved." : @"Stopped";
  if ([verdict isEqual:@"unjudged"]) return @"Could not judge";
  if ([verdict isEqual:@"regression"]) return @"Regression found";
  if ([verdict isEqual:@"clear"]) return @"No regression";
  if (code == 1 && [name isEqual:@"baseline"]) return @"Saved, but it needs more runs to compare with.";
  NSDictionary *count = run[@"count"];
  if ([name isEqual:@"flows"] && [count[@"failed"] intValue]) return [NSString stringWithFormat:@"%@ of %@ flows passed.", count[@"passed"], count[@"all"]];
  if (code) return code == 1 && [name isEqual:@"flows"] ? @"Some failed" : @"It failed. Show Details says why.";
  if ([name isEqual:@"timeline"] && count[@"frames"]) return [NSString stringWithFormat:@"Timeline saved, with %@ frames.", count[@"frames"]];
  NSDictionary *done = @{@"baseline": @"Baseline saved.", @"survey": @"Every measure ran.", @"flows": @"All passed", @"timeline": @"Timeline saved.", @"flight": @"Flight recorder ended.", @"dashboard": @"Dashboard written.", @"tools": @"Trace tools are here.", @"clients-preview": @"These lines go into your clients.", @"clients": @"Added to your clients.", @"path-on": @"On the PATH.", @"path-off": @"Off the PATH.", @"update-check": @"Checked. Show Details says what it found.", @"update": @"Updated."};
  return done[name] ?: @"Done";
}

/// Orange where a person has more to do and nothing is wrong: never green for what is no pass.
static BOOL unfinished(NSString *word) {
  return [word isEqual:@"Could not judge"] || [word isEqual:@"Saved, but it needs more runs to compare with."];
}

static NSString *durationOf(double seconds) {
  int all = (int)round(seconds);
  return MVWord(all < 60 ? [NSString stringWithFormat:@"%d s", all] : [NSString stringWithFormat:@"%d min %d s", all / 60, all % 60]);
}

@implementation MVToolRow {
  NSTextField *_title, *_hint, *_result, *_meta, *_log;
  MVInk *_mark;
  NSProgressIndicator *_turning;
  NSStackView *_resultLine;
  NSView *_lackChip;
  NSButton *_open, *_details;
  NSView *_logCard;
  NSMutableString *_said;
  NSString *_command, *_device;
  NSDate *_began;
}

- (instancetype)initWithAbout:(NSArray<NSString *> *)about hue:(NSInteger)hue owner:(id)owner run:(SEL)run open:(SEL)open {
  if ((self = [super init])) {
    NSString *name = about[0];
    _needs = about[3];
    _verb = about[4];
    _button = MVPlacePrimary(_verb, [@"run:" stringByAppendingString:name], owner, run);
    _button.quiet = YES;
    _button.hue = MVHue(hue);
    _open = MVPlaceButton(@"Open", [@"open:" stringByAppendingString:name], owner, open);
    _details = MVPlaceButton(@"Show Details", [@"details:" stringByAppendingString:name], self, @selector(toggleDetails:));
    _open.hidden = _details.hidden = YES;
    _title = MVText(about[1], MVStyleBody);
    _hint = MVParagraph(about[2], MVStyleSub);
    _mark = [[MVInk alloc] initWithSymbol:@"circle" color:MVQuietColor() size:12];
    [_mark.widthAnchor constraintEqualToConstant:16].active = YES;
    _result = MVParagraph(@"", MVStyleCallout);
    _turning = [NSProgressIndicator new];
    _turning.style = NSProgressIndicatorStyleSpinning;
    _turning.controlSize = NSControlSizeSmall;
    _turning.hidden = YES;
    _resultLine = [NSStackView stackViewWithViews:@[_turning, _mark, _result]];
    _resultLine.spacing = 4;
    _resultLine.hidden = YES;
    _meta = MVText(@"", MVStyleSub);
    _meta.hidden = YES;
    _lackChip = MVChip(@"circle.dashed", @"", MVQuietColor());
    _lackChip.hidden = YES;
    NSStackView *lines = MVPlaceColumn(@[_title, _hint, _resultLine, _meta], 1);
    [lines setContentHuggingPriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
    NSStackView *words = [NSStackView stackViewWithViews:@[MVTile(symbolOf(name), MVHueTile(hue), kTileSide), lines]];
    words.spacing = 12;
    words.distribution = NSStackViewDistributionFill;
    NSView *top = MVPlaceRow(words, @[_details, _open, _lackChip, _button]);
    [top.heightAnchor constraintGreaterThanOrEqualToConstant:kRowLeast].active = YES;
    _log = MVCodeText(@"");
    _logCard = MVCard(_log, 8);
    _logCard.hidden = YES;
    NSStackView *whole = MVPlaceColumn(@[top, _logCard], 4);
    whole.edgeInsets = NSEdgeInsetsMake(kRowInset, 0, kRowInset, 0);
    _view = whole;
  }
  return self;
}

- (void)needs:(nullable NSString *)lack {
  _button.enabled = !lack;
  _button.hidden = lack != nil;
  _lackChip.hidden = !lack;
  if (lack) MVChipSay(_lackChip, lack);
}

- (void)tell:(NSString *)word symbol:(NSString *)symbol color:(NSColor *)color {
  BOOL fresh = _resultLine.hidden;
  _hint.hidden = YES;
  _resultLine.hidden = NO;
  [_mark paint:symbol color:color];
  _result.stringValue = MVWord(word);
  if (!fresh) return;
  _resultLine.wantsLayer = YES;
  MVFade(_resultLine.layer, 0, 1, kShowSeconds);
}

/// Something turns only while something runs, and a person who asked for less motion has the still mark and the words.
- (void)turn:(BOOL)on {
  BOOL turns = on && MVMoves();
  _turning.hidden = !turns;
  _mark.hidden = turns;
  if (turns) [_turning startAnimation:nil];
  else [_turning stopAnimation:nil];
}

- (void)began:(NSDictionary *)run device:(nullable NSString *)device {
  self.running = run[@"name"];
  self.armed = NO;
  _button.quiet = YES;
  _command = [NSString stringWithFormat:@"$ %@", run[@"command"]];
  _said = [NSMutableString string];
  _device = device;
  _began = [NSDate date];
  self.file = nil;
  _open.hidden = _meta.hidden = YES;
  _details.hidden = NO;
  _button.title = MVWord(@"Stop");
  [self tell:@"Running…" symbol:@"circle.dotted" color:MVQuietColor()];
  [self turn:YES];
}

- (void)heardText:(NSString *)text {
  [_said appendString:text];
  NSArray<NSString *> *lines = [[_said stringByTrimmingCharactersInSet:NSCharacterSet.newlineCharacterSet] componentsSeparatedByString:@"\n"];
  NSUInteger from = lines.count > kLinesShown ? lines.count - kLinesShown : 0;
  // the command stays in sight, however much it says
  NSArray<NSString *> *shown = [lines subarrayWithRange:NSMakeRange(from, lines.count - from)];
  _log.stringValue = [[@[_command ?: @""] arrayByAddingObjectsFromArray:shown] componentsJoinedByString:@"\n"];
}

- (void)ended:(NSDictionary *)run {
  NSString *sentence = sentenceOf(run);
  BOOL good = [run[@"code"] intValue] == 0, stopped = [run[@"stopped"] boolValue], more = unfinished(sentence);
  BOOL plain = [sentence isEqual:@"Stopped"];
  [self tell:sentence symbol:plain ? @"stop.circle" : more ? @"exclamationmark.triangle.fill" : good || stopped ? @"checkmark.circle.fill" : @"xmark.octagon.fill" color:plain ? MVQuietColor() : more ? MVOrange() : good || stopped ? MVGreen() : MVRed()];
  [self turn:NO];
  [_resultLine layoutSubtreeIfNeeded];
  MVPulse(_mark, kEndGrows);
  MVAnnounce(sentence);
  self.running = nil;
  _button.title = MVWord(_verb);
  NSString *took = durationOf(-_began.timeIntervalSinceNow);
  _meta.stringValue = _device ? [NSString stringWithFormat:@"%@ · %@", _device, took] : took;
  _meta.hidden = !_began;
  self.file = run[@"file"];
  _open.hidden = !self.file;
}

/// What a preview ends in: the same button, in colour, does what it showed.
- (void)armAs:(NSString *)title {
  self.armed = YES;
  _button.title = MVWord(title);
  _button.quiet = NO;
  [self showDetails:YES];
}

- (void)showDetails:(BOOL)shown {
  _logCard.hidden = !shown;
  _details.title = MVWord(shown ? @"Hide Details" : @"Show Details");
}

- (void)toggleDetails:(id)sender {
  [self showDetails:_logCard.hidden];
}

@end
