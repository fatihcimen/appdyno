// Connect a Phone: stands where the hub has nothing to show, and later by its sidebar row. It holds the phone's current step
// only, moved on by what the parent reads of the phone. Nothing here is a gate: where the Mac cannot see a step done, a
// person says so by a word, and every other part of the hub stays open meanwhile.
#import "Place.h"
#import "Window.h"
#import "Words.h"

// while this place shows; nothing looks at a phone while it does not
static const double kLookSeconds = 3;
static const double kPictureWide = 216, kPictureTall = 196, kWashShare = 0.46, kWashInset = 12, kSlideFrom = 14;

/// What a phone of this maker calls a place, for the two steps that differ.
static NSString *placeOn(NSString *step, NSString *maker) {
  BOOL building = [step isEqual:@"developer-options"];
  NSDictionary *known = building ? @{@"samsung": @"Settings, About phone, Software information, Build number", @"xiaomi": @"Settings, About phone, OS version", @"google": @"Settings, About phone, Build number"} : @{@"samsung": @"Settings, Developer options", @"xiaomi": @"Settings, Additional settings, Developer options", @"google": @"Settings, System, Developer options"};
  return known[maker] ?: building ? @"Settings, About phone, Build number. On some phones it is under Software information."
                                  : @"Settings, Developer options. On some phones it is under System.";
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
  NSButton *_terms, *_back, *_toClients, *_detailsOfGet, *_startClients, *_startHelp;
  MVAccentButton *_get, *_next, *_open, *_build;
  NSStackView *_body, *_termsLine;
  MVStepper *_ticks, *_started;
  NSView *_ticksCard, *_runnerCard, *_gotCard;
  NSTextField *_gotText;
  NSTextField *_runnerLines;
  MVWifiCard *_wifi;
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
    _startClients = MVPlaceButton(@"Open", @"startClients", self, @selector(toClients:));
    _startHelp = MVPlaceButton(@"Open", @"startHelp", self, @selector(toHelp:));
    NSView *head = MVPlaceHead(@"cable.connector", MVHueTile(1), @"Connect a Phone", @"Plug it in, and this window takes you through the rest.");
    _wifi = [MVWifiCard new];
    NSStackView *column = MVPlaceColumn(@[head, [self stepCard], [self ticks], [self runnerCard], _wifi.view, [self otherWays], [self startedCard]], 16);
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
  NSView *wash = MVWash();
  _count = MVText(@"", MVStyleSub);
  _title = MVParagraph(@"", MVStyleTitle);
  _say = MVParagraph(@"", MVStyleBody);
  _where = MVParagraph(@"", MVStyleCallout);
  _more = MVParagraph(@"", MVStyleSub);
  _terms = MVPlaceButton(@"Read Google's Terms", @"terms", self, @selector(readTerms:));
  _get = MVPlacePrimary(@"Accept and Get adb", @"getAdb", self, @selector(getAdb:));
  _detailsOfGet = MVPlaceButton(@"Show Details", @"adbDetails", self, @selector(toggleGot:));
  _back = MVPlaceButton(@"Back", @"stepBack", self, @selector(stepBack:));
  _next = MVPlacePrimary(@"Next", @"stepNext", self, @selector(stepNext:));
  _open = MVPlacePrimary(@"Open", @"openPhone", self, @selector(openPhone:));
  _toClients = MVPlaceButton(@"AI Clients", @"toClients", self, @selector(toClients:));
  NSStackView *buttons = [NSStackView stackViewWithViews:@[_next, _back, _get, _detailsOfGet, _open, _toClients]];
  buttons.spacing = 8;
  _termsLine = [NSStackView stackViewWithViews:@[_terms]];
  _gotText = MVCodeText(@"");
  _gotCard = MVCard(_gotText, 8);
  _gotCard.hidden = YES;
  _body = MVPlaceColumn(@[_count, _title, _say, _where, _more, buttons, _termsLine, _gotCard], 6);
  [_body setCustomSpacing:12 afterView:_more];
  NSView *all = [NSView new];
  for (NSView *part in @[wash, _picture, _body]) {
    part.translatesAutoresizingMaskIntoConstraints = NO;
    [all addSubview:part];
  }
  [NSLayoutConstraint activateConstraints:@[
    [wash.leadingAnchor constraintEqualToAnchor:all.leadingAnchor],
    [wash.topAnchor constraintEqualToAnchor:all.topAnchor],
    [wash.bottomAnchor constraintEqualToAnchor:all.bottomAnchor],
    [wash.widthAnchor constraintEqualToAnchor:all.widthAnchor
                                   multiplier:kWashShare],
    [wash.heightAnchor constraintGreaterThanOrEqualToConstant:kPictureTall + 2 * kWashInset],
    [_picture.widthAnchor constraintEqualToConstant:kPictureWide],
    [_picture.heightAnchor constraintEqualToConstant:kPictureTall],
    [_picture.centerXAnchor constraintEqualToAnchor:wash.centerXAnchor],
    [_picture.centerYAnchor constraintEqualToAnchor:wash.centerYAnchor],
    [_body.leadingAnchor constraintEqualToAnchor:wash.trailingAnchor
                                        constant:16],
    [_body.trailingAnchor constraintEqualToAnchor:all.trailingAnchor
                                         constant:-4],
    [_body.centerYAnchor constraintEqualToAnchor:all.centerYAnchor],
    [_body.topAnchor constraintGreaterThanOrEqualToAnchor:all.topAnchor],
    [_body.bottomAnchor constraintLessThanOrEqualToAnchor:all.bottomAnchor],
  ]];
  return MVCard(all, 12);
}

- (NSView *)ticks {
  _ticks = MVNewStepper();
  _ticksCard = MVCard(_ticks, 8);
  return _ticksCard;
}

- (NSView *)runnerCard {
  _runnerLines = MVParagraph(@"", MVStyleSub);
  // what the runner's checks found, as a tool says it
  MVHoldContent(_runnerLines);
  _build = MVPlacePrimary(@"Build Runner", @"run:runner", self, @selector(buildRunner:));
  NSView *head = MVPlaceRow(MVText(@"An iPhone Runner", MVStyleStrong), @[_build]);
  _runnerCard = MVCard(MVPlaceColumn(@[head, MVParagraph(@"To drive an iPhone by its screen, appdyno puts a small runner on it. That takes Xcode and a signing team.", MVStyleCallout), _runnerLines], 6), 12);
  return _runnerCard;
}

- (NSView *)otherWays {
  NSStackView *words = MVPlaceColumn(@[MVText(@"No Phone?", MVStyleStrong), MVParagraph(@"A simulator or an emulator needs none of this.", MVStyleCallout)], 2);
  return MVCard(MVPlaceRow(words, @[MVPlaceButton(@"New Simulator", @"newSimulator", self, @selector(newSimulator:)), MVPlaceButton(@"New Emulator", @"newEmulator", self, @selector(newEmulator:))]), 12);
}

- (NSView *)startedCard {
  _started = MVNewStepper();
  return MVPlaceColumn(@[MVText(@"Get Started", MVStyleHeading), MVCard(_started, 8)], 6);
}

- (void)viewDidMoveToWindow {
  [_timer invalidate];
  _timer = nil;
  if (!self.window) return;
  MVAskClients(@"connect", @{@"fresh": @YES});
  __weak MVConnectPane *weak = self;
  _timer = [NSTimer scheduledTimerWithTimeInterval:kLookSeconds
                                           repeats:YES
                                             block:^(__unused NSTimer *timer) {
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
  [_wifi show:guide];
  [self drawStep];
  // what stood here unready and got ready is the phone a person just worked on: a phone that was ready all along waits to be chosen
  if (serial && ready && [_unready containsObject:serial]) {
    // the first opens: a second phone waits for its row
    [_unready removeAllObjects];
    if (self.onReady) self.onReady(serial);
  }
}

/// What stands in the step's place: a step, or what the phone itself said, or that it is ready.
- (NSArray *)current {
  NSDictionary *need = _guide[@"needWords"];
  NSString *maker = _guide[@"maker"];
  if (need) return @[_guide[@"need"], @[need[@"title"], need[@"fix"], @"", @""]];
  // a phone's name is its own: the sentence is said here, and passes through what says the rest as it is
  if ([self phoneReady]) return @[@"ready", @[MVFormat(@"%@ is ready", @[_guide[@"name"] ?: MVWord(@"Your phone")]), @"Ask your AI app what is on its screen.", @"", @""]];
  NSString *step = [self stepLeft][@"id"] ?: @"plug";
  return @[step, wordsOf(step, maker)];
}

- (void)drawStep {
  NSArray *current = self.current;
  NSString *step = current[0];
  NSArray<NSString *> *words = current[1];
  BOOL moved = _shownStep && ![_shownStep isEqual:step];
  _shownStep = step;
  _picture.step = _guide[@"needWords"] && ![@[@"locked", @"asleep"] containsObject:step] ? @"plug" : step;
  _picture.accessibilityLabel = MVWord(words[1]);
  _title.stringValue = MVWord(words[0]);
  _say.stringValue = MVWord(words[1]);
  _where.stringValue = MVWord(words[2]);
  _where.hidden = !words[2].length;
  BOOL failed = _got.length && !_getting;
  _more.stringValue = failed ? MVWord(@"Getting adb failed.") : _guide ? MVWord(words[3])
                                                                       : @"";
  _gotText.stringValue = _got ?: @"";
  _detailsOfGet.hidden = !failed;
  if (!failed) _gotCard.hidden = YES;
  _more.hidden = !_more.stringValue.length;
  NSArray *steps = _guide[@"steps"];
  NSDictionary *left = [self stepLeft];
  NSUInteger at = left ? [steps indexOfObject:left] : NSNotFound;
  BOOL counted = left && steps.count > 1 && !_guide[@"needWords"];
  _count.hidden = !counted;
  if (counted) _count.stringValue = MVWord([NSString stringWithFormat:@"Step %lu of %lu", (unsigned long)at + 1, (unsigned long)steps.count]);
  BOOL getting = [step isEqual:@"get-adb"];
  _termsLine.hidden = _get.hidden = !getting;
  _get.enabled = !_getting;
  _get.title = MVWord(_getting ? @"Getting adb…" : @"Accept and Get adb");
  BOOL unseen = left && ![left[@"sees"] boolValue] && !_guide[@"needWords"];
  _next.hidden = !unseen;
  _back.hidden = !unseen || !_passed.count;
  _open.hidden = _toClients.hidden = ![step isEqual:@"ready"];
  // one colour on a screen: the runner takes it only where nothing else asks for it
  _build.quiet = !_next.hidden || !_get.hidden || !_open.hidden;
  [self drawLists];
  if (!moved) return;
  MVSlideIn(_body, kSlideFrom);
  MVSlideIn(_picture, kSlideFrom);
  MVAnnounce(words[0]);
}

- (void)drawLists {
  NSArray *steps = _guide[@"steps"];
  NSMutableArray<NSDictionary *> *items = [NSMutableArray array];
  NSDictionary *left = [self stepLeft];
  for (NSDictionary *step in steps) {
    BOOL done = [step[@"done"] boolValue] || (left && [steps indexOfObject:step] < [steps indexOfObject:left]) || (!left && [_passed containsObject:step[@"id"]]);
    [items addObject:@{@"title": wordsOf(step[@"id"], _guide[@"maker"])[0], @"state": done ? @"done" : step == left ? @"now"
                                                                                                                    : @"later"}];
  }
  [_ticks showItems:items];
  _ticksCard.hidden = steps.count == 0;
  _runnerCard.hidden = ![_guide[@"maker"] isEqual:@"apple"];
  NSMutableArray<NSString *> *lines = [NSMutableArray array];
  for (NSDictionary *check in _guide[@"runner"]) [lines addObject:[NSString stringWithFormat:@"%@: %@", check[@"name"], check[@"detail"]]];
  _runnerLines.stringValue = [lines componentsJoinedByString:@"\n"];
  _runnerLines.hidden = lines.count == 0;
  NSArray<NSNumber *> *ticked = @[@(self.hasDevice), @([_guide[@"client"] boolValue]), @([_guide[@"prompt"] boolValue])];
  NSUInteger now = [ticked indexOfObject:@NO];
  NSArray<NSString *> *titles = @[@"Add a device", @"Connect an AI client", @"Try a prompt"];
  NSMutableArray<NSDictionary *> *started = [NSMutableArray array];
  [titles enumerateObjectsUsingBlock:^(NSString *title, NSUInteger at, __unused BOOL *stop) {
    NSMutableDictionary *item = [@{@"title": title, @"state": ticked[at].boolValue ? @"done" : at == now ? @"now"
                                                                                                         : @"later"} mutableCopy];
    if (at) item[@"end"] = at == 1 ? self->_startClients : self->_startHelp;
    [started addObject:item];
  }];
  [_started showItems:started];
}

- (void)setHasDevice:(BOOL)hasDevice {
  if (hasDevice == _hasDevice) return;
  _hasDevice = hasDevice;
  [self drawLists];
}

/// What was run from here came to an end: the next look says what it changed.
- (void)heard:(NSDictionary *)run {
  [_wifi heard:run];
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

- (void)toggleGot:(id)sender {
  _gotCard.hidden = !_gotCard.hidden;
  _detailsOfGet.title = MVWord(_gotCard.hidden ? @"Show Details" : @"Hide Details");
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

/// A phone that was ready all along waits for this.
- (void)openPhone:(id)sender {
  if (self.onOpen && _guide[@"serial"]) self.onOpen(_guide[@"serial"]);
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
