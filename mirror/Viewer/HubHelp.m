// Help: what appdyno is, what to ask an AI client for, what every word in the hub means, and what to do when something
// fails. It needs no network. A prompt is filled with the device and the app last in front; a client's own notes on it are the
// parent's, as a client's name is written nowhere here.
#import "HubHelpParts.h"
#import "Place.h"
#import "Window.h"
#import "Words.h"

static const double kBetweenSections = 24, kShowSeconds = 0.2, kCardTile = 28;

typedef struct {
  NSString *device, *of, *in, *object;
} MVFilled;

static NSString *promptOf(NSUInteger card, MVFilled f) {
  switch (card) {
    case 0:
      return MVFormat(@"%@, what is on the screen? Check it for accessibility problems and list the three worst.", @[f.device]);
    case 1:
      return MVFormat(@"%@, try sign-in %@. Stop at the first failure and show me a screenshot.", @[f.device, f.in]);
    case 2:
      return MVFormat(@"%@, measure a cold launch %@ and tell me how long it takes.", @[f.device, f.of]);
    case 3:
      return MVFormat(@"%@, compare %@ with its baseline. If anything got worse, tell me why.", @[f.device, f.object]);
    default:
      return MVFormat(@"%@, install the two builds %@ that I give you, measure each and tell me which is faster.", @[f.device, f.of]);
  }
}

static MVFilled filled(NSDictionary *_Nullable device, NSString *_Nullable app) {
  NSString *name = device ? MVDeviceRow(device).title : nil;
  MVFilled f;
  f.device = name.length ? MVFormat(@"On %@", @[name]) : MVWord(@"On my device");
  f.of = app.length ? MVFormat(@"of %@", @[app]) : MVWord(@"of my app");
  f.in = app.length ? MVFormat(@"in %@", @[app]) : MVWord(@"in my app");
  f.object = app.length ? MVFormat(@"the app %@", @[app]) : MVWord(@"my app");
  return f;
}

static NSArray<NSDictionary *> *cards(void) {
  return @[
    @{@"goal": MVWord(@"Check a screen"), @"symbol": @"eye", @"does": MVWord(@"Reads only: it looks at the screen and changes nothing."), @"tools": @"screen, audit", @"kinds": @[@"picture"]},
    @{@"goal": MVWord(@"Test a flow"), @"symbol": @"hand.tap", @"does": MVWord(@"Changes the device: it taps and types as you would."), @"tools": @"tap, type_text, screenshot", @"kinds": @[@"acts", @"picture"]},
    @{@"goal": MVWord(@"Measure launch"), @"symbol": @"timer", @"does": MVWord(@"Restarts the app: a cold launch starts from closed."), @"tools": @"perf_launch", @"kinds": @[@"long"]},
    @{@"goal": MVWord(@"Find why it got slower"), @"symbol": @"chart.line.downtrend.xyaxis", @"does": MVWord(@"Restarts the app: it measures again, then looks at where the time went."), @"tools": @"perf_compare, perf_profile", @"kinds": @[@"long"]},
    @{@"goal": MVWord(@"Compare two builds"), @"symbol": @"square.split.2x1", @"does": MVWord(@"Changes the device: it installs each build, and restarts the app to measure it."), @"tools": @"app, perf_launch, perf_compare", @"kinds": @[@"long", @"acts"]},
  ];
}

@implementation MVHelpPane {
  NSMutableArray<NSTextField *> *_prompts;
  NSMutableArray<NSStackView *> *_cardNotes;
  NSArray<NSDictionary *> *_notes;
  NSStackView *_checks;
  NSButton *_doctor;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _prompts = [NSMutableArray array];
    _cardNotes = [NSMutableArray array];
    _checks = MVPlaceColumn(@[], 6);
    NSView *head = MVPlaceHead(@"questionmark.circle", MVHueTile(4), @"Help", @"What to ask for, what each word means, and what to do when something fails.");
    NSStackView *column = MVPlaceColumn(@[head, [self about], [self prompts], [self meanings], [self failing]], kBetweenSections);
    NSScrollView *page = MVPlacePage(column);
    page.frame = self.bounds;
    page.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [self addSubview:page];
    [self fillDevice:nil app:nil];
  }
  return self;
}

- (void)viewDidMoveToWindow {
  if (self.window) MVAskClients(@"list", @{});
}

- (NSView *)about {
  return MVCard(MVPlaceColumn(@[MVParagraph(@"appdyno lets an AI client see and drive your iPhones, Android phones, simulators and emulators from this Mac. It taps, types, reads the screen and measures how fast your app really is, and it shows all of that here as it happens. Everything runs on this Mac, with no account and no telemetry.", MVStyleBody)], 8), 12);
}

- (NSView *)prompts {
  NSMutableArray<NSView *> *views = [NSMutableArray arrayWithObjects:MVText(@"What You Can Ask an AI to Do", MVStyleTitle), MVParagraph(@"Copy one into your AI client. Any prompt works in any client, and each says what it does to the device.", MVStyleCallout), nil];
  [cards() enumerateObjectsUsingBlock:^(NSDictionary *card, NSUInteger at, BOOL *stop) {
    [views addObject:[self card:card at:at]];
  }];
  return MVPlaceColumn(views, 8);
}

- (NSView *)card:(NSDictionary *)card at:(NSUInteger)at {
  NSStackView *head = [NSStackView stackViewWithViews:@[MVTile(card[@"symbol"], MVHueTile((NSInteger)at), kCardTile), MVText(card[@"goal"], MVStyleStrong)]];
  head.spacing = 10;
  MVAccentButton *copy = (MVAccentButton *)MVPlaceButton(@"Copy", [NSString stringWithFormat:@"copyPrompt:%lu", (unsigned long)at], self, @selector(copyPrompt:));
  copy.hue = MVHue((NSInteger)at);
  [head addView:[NSView new] inGravity:NSStackViewGravityTrailing];
  [head addView:copy inGravity:NSStackViewGravityTrailing];
  NSTextField *prompt = MVParagraph(@"", MVStyleBody);
  prompt.selectable = YES;
  [_prompts addObject:prompt];
  NSStackView *notes = MVPlaceColumn(@[], 2);
  [_cardNotes addObject:notes];
  NSTextField *does = MVParagraph(card[@"does"], MVStyleSub);
  NSTextField *tools = MVParagraph(MVFormat(@"Tools: %@", @[card[@"tools"]]), MVStyleSub);
  return MVCard(MVPlaceColumn(@[head, prompt, does, tools, notes], 6), 12);
}

- (void)fillDevice:(nullable NSDictionary *)device app:(nullable NSString *)app {
  MVFilled words = filled(device, app);
  [_prompts enumerateObjectsUsingBlock:^(NSTextField *field, NSUInteger at, BOOL *stop) {
    field.stringValue = promptOf(at, words);
  }];
}

- (void)copyPrompt:(NSButton *)sender {
  NSUInteger at = [sender.identifier substringFromIndex:@"copyPrompt:".length].integerValue;
  MVCopyText(_prompts[at].stringValue, MVPlaceBoard());
  MVSayCopied(sender);
}

- (void)showNotes:(NSArray<NSDictionary *> *)notes {
  if ([notes isEqual:_notes]) return;
  _notes = notes;
  NSArray<NSDictionary *> *all = cards();
  [_cardNotes enumerateObjectsUsingBlock:^(NSStackView *stack, NSUInteger at, BOOL *stop) {
    for (NSView *view in stack.arrangedSubviews) [view removeFromSuperview];
    for (NSDictionary *note in notes)
      if ([all[at][@"kinds"] containsObject:note[@"kind"]]) [stack addArrangedSubview:MVNoteText(MVFormat(@"In %@: %@", @[MVSaid(@{@"en": note[@"client"], @"tr": note[@"clientTr"] ?: note[@"client"]}), MVSaid(note)]))];
  }];
}

- (NSView *)meanings {
  NSMutableArray<NSView *> *rows = [NSMutableArray array];
  NSMutableArray<NSView *> *views = [NSMutableArray arrayWithObjects:MVText(@"What Each Panel and Number Means", MVStyleTitle), MVCard(MVPlaceColumn(@[MVParagraph(@"A real device is needed for real measurement. A simulator or an emulator measures this Mac, so its numbers compare only with themselves. Real frame rates, frozen frames, hitches and energy need a phone.", MVStyleStrong)], 0), 12), nil];
  for (NSArray<NSString *> *pair in MVHelpMeanings()) {
    [rows addObject:MVPlaceColumn(@[MVText(pair[0], MVStyleStrong), MVParagraph(pair[1], MVStyleSub)], 1)];
  }
  [views addObject:MVCard(MVPlaceColumn(rows, 10), 12)];
  return MVPlaceColumn(views, 8);
}

- (NSView *)failing {
  _doctor = MVPlacePrimary(@"Run Doctor", @"runDoctor", self, @selector(runDoctor:));
  NSStackView *lead = [NSStackView stackViewWithViews:@[MVParagraph(@"Doctor checks this Mac and says what it lacks, as appdyno doctor does in a terminal.", MVStyleCallout)]];
  [lead addView:_doctor inGravity:NSStackViewGravityTrailing];
  NSMutableArray<NSView *> *rows = [NSMutableArray array];
  for (NSArray<NSString *> *pair in MVHelpFailures()) [rows addObject:MVPlaceColumn(@[MVText(pair[0], MVStyleStrong), MVParagraph(pair[1], MVStyleSub)], 1)];
  return MVPlaceColumn(@[MVText(@"When Something Fails", MVStyleTitle), lead, _checks, MVCard(MVPlaceColumn(rows, 10), 12)], 8);
}

- (void)runDoctor:(NSButton *)sender {
  _doctor.enabled = NO;
  _doctor.title = MVWord(@"Checking…");
  MVAskClients(@"doctor", @{});
}

- (void)showDoctor:(NSArray<NSDictionary *> *)checks {
  _doctor.enabled = YES;
  _doctor.title = MVWord(@"Run Doctor");
  for (NSView *view in _checks.arrangedSubviews) [view removeFromSuperview];
  for (NSDictionary *check in checks) {
    BOOL ok = [check[@"ok"] boolValue], warn = [check[@"warn"] boolValue];
    MVInk *mark = [[MVInk alloc] initWithSymbol:ok ? @"checkmark.circle.fill" : warn ? @"exclamationmark.triangle.fill" : @"xmark.octagon.fill" color:ok ? MVGreen() : warn ? MVOrange() : MVRed() size:13];
    [mark.widthAnchor constraintEqualToConstant:18].active = YES;
    NSMutableArray<NSView *> *words = [NSMutableArray arrayWithObject:MVText([NSString stringWithFormat:@"%@: %@", check[@"name"], check[@"detail"]], MVStyleCallout)];
    if ([check[@"fix"] length]) [words addObject:MVParagraph(check[@"fix"], MVStyleSub)];
    NSStackView *row = [NSStackView stackViewWithViews:@[mark, MVPlaceColumn(words, 1)]];
    row.spacing = 6;
    row.alignment = NSLayoutAttributeTop;
    [_checks addArrangedSubview:row];
  }
  _checks.wantsLayer = YES;
  MVFade(_checks.layer, 0, 1, kShowSeconds);
  MVAnnounce(@"Doctor has finished");
}

@end
