// Connect a Phone: stands where the hub has nothing to show, and later by its sidebar row. It holds the phone's current step
// only, moved on by what the parent reads of the phone. Nothing here is a gate: where the Mac cannot see a step done, a
// person says so by a word, and every other part of the hub stays open meanwhile.
#import "Place.h"
#import "Window.h"
#import "Words.h"

// while this place shows; nothing looks at a phone while it does not
static const double kLookSeconds = 3, kShowSeconds = 0.2;
static const double kPictureWide = 216, kPictureTall = 196;
static const double kTickSize = 13;

/// What a phone of this maker calls a place, for the two steps that differ.
static NSString *placeOn(NSString *step, NSString *maker) {
  BOOL building = [step isEqual:@"developer-options"];
  NSDictionary *known = building ? @{@"samsung": @"Settings, About phone, Software information, Build number", @"xiaomi": @"Settings, About phone, OS version", @"google": @"Settings, About phone, Build number"} : @{@"samsung": @"Settings, Developer options", @"xiaomi": @"Settings, Additional settings, Developer options", @"google": @"Settings, System, Developer options"};
  return known[maker] ?: building ? @"Settings, About phone, Build number. On some phones it is under Software information." : @"Settings, Developer options. On some phones it is under System.";
}

/// A step's title, its one sentence, where it is on the phone, and what is said when that is not enough.
static NSArray<NSString *> *wordsOf(NSString *step, NSString *maker) {
  NSString *menu = @"Settings, Additional settings, Developer options";
  NSDictionary<NSString *, NSArray<NSString *> *> *all = @{
    @"get-adb": @[@"Get adb", @"This Mac talks to an Android phone through adb, which comes from Google under its own terms.", @"", @""],
    @"developer-options": @[@"Turn on Developer options", [maker isEqual:@"xiaomi"] ? @"Tap OS version seven times." : @"Tap Build number seven times.", placeOn(step, maker), @""],
    @"usb-debugging": @[@"Turn on USB debugging", @"Find it in Developer options, and turn it on.", placeOn(step, maker), @""],
    @"allow": @[@"Allow USB debugging", @"On the phone, tick Always allow, then tap Allow.", @"", @"If the screen is dark, wake and unlock it: this Mac cannot see that, and the question waits there."],
    @"xiaomi-security": @[@"Turn on USB debugging (Security settings)", @"It lets appdyno touch the screen.", menu, @""],
    @"xiaomi-install": @[@"Turn on Install via USB", @"It lets appdyno put its helper on the phone.", menu, @""],
    @"get-xcode": @[@"Get Xcode", @"Install Xcode from the App Store, and open it once.", @"", @""],
    @"trust": @[@"Trust this Mac", @"Unlock the phone, tap Trust, then enter your passcode.", @"", @"If nothing asks, unplug the phone and plug it in again while it is unlocked."],
    @"developer-mode": @[@"Turn on Developer Mode", @"Your phone restarts when you turn this on.", @"Settings, Privacy & Security, Developer Mode.", @"After it restarts, unlock it and tap Turn On."],
  };
  return all[step] ?: @[@"Plug in your phone", @"Use a cable that carries data.", @"", @"Nothing shows on this Mac yet. A cable that only charges shows nothing, so try another one."];
}

@implementation MVConnectPane {
  MVStepPicture *_picture;
  NSTextField *_count, *_title, *_say, *_where, *_more;
  NSButton *_terms, *_get, *_back, *_next, *_toClients;
  NSStackView *_body, *_ticks, *_started;
  NSView *_ticksCard, *_runnerCard;
  NSTextField *_runnerLines;
  NSMutableSet<NSString *> *_passed, *_unready;
  NSDictionary *_guide;
  NSString *_shownStep;
  NSMutableString *_got;
  BOOL _getting;
  NSTimer *_timer;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _passed = [NSMutableSet set];
    _unready = [NSMutableSet set];
    NSStackView *column = MVPlaceColumn(@[[self stepCard], [self ticks], [self runnerCard], [self otherWays], [self startedCard]], 16);
    NSScrollView *page = MVPlacePage(column);
    page.frame = self.bounds;
    page.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [self addSubview:page];
    [self drawStep];
  }
  return self;
}

- (NSView *)stepCard {
  _picture = [MVStepPicture new];
  [_picture.widthAnchor constraintEqualToConstant:kPictureWide].active = YES;
  [_picture.heightAnchor constraintEqualToConstant:kPictureTall].active = YES;
  _count = MVText(@"", MVStyleSub);
  _title = MVParagraph(@"", MVStyleTitle);
  _say = MVParagraph(@"", MVStyleBody);
  _where = MVParagraph(@"", MVStyleCallout);
  _more = MVParagraph(@"", MVStyleSub);
  _terms = MVPlaceButton(@"Read Google's Terms", @"terms", self, @selector(readTerms:));
  _get = MVPlacePrimary(@"Accept and Get adb", @"getAdb", self, @selector(getAdb:));
  _back = MVPlaceButton(@"Back", @"stepBack", self, @selector(stepBack:));
  _next = MVPlacePrimary(@"Next", @"stepNext", self, @selector(stepNext:));
  _toClients = MVPlacePrimary(@"AI Clients", @"toClients", self, @selector(toClients:));
  NSStackView *buttons = [NSStackView stackViewWithViews:@[_back, _next, _terms, _get, _toClients]];
  buttons.spacing = 8;
  _body = MVPlaceColumn(@[_count, _title, _say, _where, _more, buttons], 6);
  [_body setCustomSpacing:12 afterView:_more];
  NSView *all = [NSView new];
  for (NSView *part in @[_picture, _body]) {
    part.translatesAutoresizingMaskIntoConstraints = NO;
    [all addSubview:part];
  }
  [NSLayoutConstraint activateConstraints:@[
    [_picture.leadingAnchor constraintEqualToAnchor:all.leadingAnchor],
    [_picture.centerYAnchor constraintEqualToAnchor:all.centerYAnchor],
    [_picture.topAnchor constraintGreaterThanOrEqualToAnchor:all.topAnchor],
    [_body.leadingAnchor constraintEqualToAnchor:_picture.trailingAnchor constant:16],
    [_body.trailingAnchor constraintEqualToAnchor:all.trailingAnchor],
    [_body.centerYAnchor constraintEqualToAnchor:all.centerYAnchor],
    [_body.topAnchor constraintGreaterThanOrEqualToAnchor:all.topAnchor],
  ]];
  return MVCard(all, 16);
}

- (NSView *)ticks {
  _ticks = MVPlaceColumn(@[], 6);
  _ticksCard = MVCard(_ticks, 12);
  return _ticksCard;
}

- (NSView *)runnerCard {
  _runnerLines = MVParagraph(@"", MVStyleSub);
  NSView *head = MVPlaceRow(MVText(@"An iPhone Runner", MVStyleStrong), @[MVPlaceButton(@"Build Runner", @"run:runner", self, @selector(buildRunner:))]);
  _runnerCard = MVCard(MVPlaceColumn(@[head, MVParagraph(@"To drive an iPhone by its screen, appdyno puts a small runner on it. That takes Xcode and a signing team.", MVStyleCallout), _runnerLines], 6), 12);
  return _runnerCard;
}

- (NSView *)otherWays {
  NSStackView *words = MVPlaceColumn(@[MVText(@"No Phone?", MVStyleStrong), MVParagraph(@"A simulator or an emulator needs none of this.", MVStyleCallout)], 2);
  return MVCard(MVPlaceRow(words, @[MVPlaceButton(@"New Simulator", @"newSimulator", self, @selector(newSimulator:)), MVPlaceButton(@"New Emulator", @"newEmulator", self, @selector(newEmulator:))]), 12);
}

- (NSView *)startedCard {
  _started = MVPlaceColumn(@[], 6);
  return MVPlaceColumn(@[MVText(@"Get Started", MVStyleHeading), MVCard(_started, 12)], 6);
}

/// A line of a list that ticks itself: a symbol, its word, and a way there where there is one.
- (NSView *)tick:(NSString *)word done:(BOOL)done now:(BOOL)now button:(nullable NSButton *)button {
  MVInk *mark = [[MVInk alloc] initWithSymbol:done ? @"checkmark.circle.fill" : now ? @"circle.inset.filled" : @"circle" color:done ? MVGreen() : now ? NSColor.controlAccentColor : MVQuietColor() size:kTickSize];
  [mark.widthAnchor constraintEqualToConstant:18].active = YES;
  NSStackView *line = [NSStackView stackViewWithViews:@[mark, MVText(word, now ? MVStyleStrong : MVStyleBody)]];
  line.spacing = 6;
  return MVPlaceRow(line, button ? @[button] : @[]);
}

- (void)fill:(NSStackView *)list with:(NSArray<NSView *> *)views {
  for (NSView *view in list.arrangedSubviews) [view removeFromSuperview];
  for (NSView *view in views) [list addArrangedSubview:view];
}

- (void)viewDidMoveToWindow {
  [_timer invalidate];
  _timer = nil;
  if (!self.window) return;
  MVAskClients(@"connect", @{@"fresh": @YES});
  __weak MVConnectPane *weak = self;
  _timer = [NSTimer scheduledTimerWithTimeInterval:kLookSeconds repeats:YES block:^(NSTimer *timer) {
    if (weak) MVAskClients(@"connect", @{});
  }];
}

/// The first step left: what is done is done, and what the Mac cannot see waits only for a person's word.
- (nullable NSDictionary *)stepLeft {
  for (NSDictionary *step in _guide[@"steps"])
    if (![step[@"done"] boolValue] && ([step[@"sees"] boolValue] || ![_passed containsObject:step[@"id"]])) return step;
  return nil;
}

- (BOOL)phoneReady {
  return [_guide[@"ready"] boolValue] && ![self stepLeft];
}

- (void)show:(NSDictionary *)guide {
  _guide = guide;
  NSString *serial = guide[@"serial"];
  BOOL ready = [self phoneReady];
  if (serial && !ready) [_unready addObject:serial];
  [self drawStep];
  // what stood here unready and got ready is the phone a person just worked on: a phone that was ready all along waits to be chosen
  if (serial && ready && [_unready containsObject:serial]) {
    [_unready removeObject:serial];
    if (self.onReady) self.onReady(serial);
  }
}

/// What stands in the step's place: a step, or what the phone itself said, or that it is ready.
- (NSArray *)current {
  NSDictionary *need = _guide[@"needWords"];
  NSString *maker = _guide[@"maker"];
  if (need) return @[_guide[@"need"], @[need[@"title"], need[@"fix"], @"", @""]];
  if ([self phoneReady]) return @[@"ready", @[[NSString stringWithFormat:@"%@ is ready", _guide[@"name"] ?: MVWord(@"Your phone")], @"Ask your AI app what is on its screen.", @"", @""]];
  NSString *step = [self stepLeft][@"id"];
  return @[step ?: @"plug", wordsOf(step, maker)];
}

- (void)drawStep {
  NSArray *current = self.current;
  NSString *step = current[0];
  NSArray<NSString *> *words = current[1];
  BOOL moved = _shownStep && ![_shownStep isEqual:step];
  _shownStep = step;
  _picture.step = [step isEqual:@"locked"] || [step isEqual:@"asleep"] ? step : [step isEqual:@"ready"] ? step : wordsOf(step, nil)[0].length ? step : @"plug";
  _picture.accessibilityLabel = MVWord(words[1]);
  _title.stringValue = MVWord(words[0]);
  _say.stringValue = MVWord(words[1]);
  _where.stringValue = MVWord(words[2]);
  _where.hidden = !words[2].length;
  BOOL failed = _got.length && !_getting;
  _more.stringValue = failed ? [NSString stringWithFormat:@"%@ %@", MVWord(@"It failed: see what it said."), _got] : MVWord(words[3]);
  _more.hidden = !_more.stringValue.length;
  NSArray *steps = _guide[@"steps"];
  NSDictionary *left = [self stepLeft];
  NSUInteger at = left ? [steps indexOfObject:left] : NSNotFound;
  BOOL counted = left && steps.count > 1 && !_guide[@"needWords"];
  _count.hidden = !counted;
  if (counted) _count.stringValue = MVWord([NSString stringWithFormat:@"Step %lu of %lu", (unsigned long)at + 1, (unsigned long)steps.count]);
  BOOL getting = [step isEqual:@"get-adb"];
  _terms.hidden = _get.hidden = !getting;
  _get.enabled = !_getting;
  _get.title = MVWord(_getting ? @"Getting adb…" : @"Accept and Get adb");
  BOOL unseen = left && ![left[@"sees"] boolValue] && !_guide[@"needWords"];
  _next.hidden = !unseen;
  _back.hidden = !unseen || !_passed.count;
  _toClients.hidden = ![step isEqual:@"ready"];
  [self drawLists];
  if (!moved) return;
  _body.wantsLayer = YES;
  MVFade(_body.layer, 0, 1, kShowSeconds);
  MVAnnounce(words[0]);
}

- (void)drawLists {
  NSArray *steps = _guide[@"steps"];
  NSMutableArray<NSView *> *rows = [NSMutableArray array];
  NSDictionary *left = [self stepLeft];
  for (NSDictionary *step in steps) {
    BOOL done = [step[@"done"] boolValue] || (left && [steps indexOfObject:step] < [steps indexOfObject:left]);
    [rows addObject:[self tick:wordsOf(step[@"id"], _guide[@"maker"])[0] done:done now:step == left button:nil]];
  }
  [self fill:_ticks with:rows];
  _ticksCard.hidden = steps.count == 0;
  BOOL iphone = _guide[@"maker"] && [_guide[@"maker"] isEqual:@"apple"];
  _runnerCard.hidden = !iphone;
  NSMutableArray<NSString *> *lines = [NSMutableArray array];
  for (NSDictionary *check in _guide[@"runner"]) [lines addObject:[NSString stringWithFormat:@"%@: %@", check[@"name"], check[@"detail"]]];
  _runnerLines.stringValue = [lines componentsJoinedByString:@"\n"];
  _runnerLines.hidden = lines.count == 0;
  [self fill:_started with:@[
    [self tick:@"Add a device" done:self.hasDevice now:NO button:nil],
    [self tick:@"Connect an AI client" done:[_guide[@"client"] boolValue] now:NO button:MVPlaceButton(@"Open", @"startClients", self, @selector(toClients:))],
    [self tick:@"Try a prompt" done:[_guide[@"prompt"] boolValue] now:NO button:MVPlaceButton(@"Open", @"startHelp", self, @selector(toHelp:))],
  ]];
}

- (void)setHasDevice:(BOOL)hasDevice {
  if (hasDevice == _hasDevice) return;
  _hasDevice = hasDevice;
  [self drawLists];
}

/// What was run from here came to an end: the next look says what it changed.
- (void)heard:(NSDictionary *)run {
  if (![run[@"name"] isEqual:@"adb"]) return;
  if (run[@"started"]) {
    _getting = YES;
    _got = [NSMutableString string];
  }
  if (run[@"text"]) [_got appendString:run[@"text"]];
  if (run[@"code"]) {
    _getting = NO;
    if ([run[@"code"] intValue] == 0) _got = nil;
    MVAskClients(@"connect", @{@"fresh": @YES});
  }
  [self drawStep];
}

- (void)readTerms:(id)sender {
  if (_guide[@"terms"]) MVOpenOutside(_guide[@"terms"]);
}

- (void)getAdb:(id)sender {
  MVAskClients(@"run", @{@"name": @"adb"});
}

- (void)buildRunner:(id)sender {
  MVAskClients(@"run", @{@"name": @"runner"});
}

- (void)stepNext:(id)sender {
  NSString *step = [self stepLeft][@"id"];
  if (step) [_passed addObject:step];
  [self drawStep];
}

- (void)stepBack:(id)sender {
  NSString *last;
  for (NSDictionary *step in _guide[@"steps"])
    if ([_passed containsObject:step[@"id"]]) last = step[@"id"];
  if (last) [_passed removeObject:last];
  [self drawStep];
}

- (void)newSimulator:(id)sender {
  if (self.onNew) self.onNew(@"simulator");
}

- (void)newEmulator:(id)sender {
  if (self.onNew) self.onNew(@"emulator");
}

- (void)toClients:(id)sender {
  if (self.onPlace) self.onPlace(@"AI Clients");
}

- (void)toHelp:(id)sender {
  if (self.onPlace) self.onPlace(@"Help");
}

@end
