// AI Clients: every client of the parent's list as it truly stands, what would change before it does, and a way back. All
// that a row knows comes from the parent; the words a client alone has, its name and how to check it, come from there too.
#import "Place.h"
#import "Window.h"
#import "Words.h"

// while this place shows, for a client that connects with nobody touching the window; nothing runs while it does not
static const double kListSeconds = 2;
static const double kRowHigh = 52, kTileSide = 32, kShowSeconds = 0.2;
// a symbol and the gap after it: what a row says of itself stands under its name
static const double kUnderName = 44;

/// A state is a symbol and a word as well as a colour.
static NSString *symbolOf(NSString *state) {
  return @{@"connected": @"checkmark.circle.fill", @"added": @"arrow.clockwise.circle.fill", @"refused": @"exclamationmark.triangle.fill", @"absent": @"minus.circle", @"browser": @"globe"}[state] ?: @"circle";
}

static NSColor *colorOf(NSString *state) {
  if ([state isEqual:@"connected"]) return MVGreen();
  return [state isEqual:@"added"] || [state isEqual:@"refused"] ? MVOrange() : MVQuietColor();
}

static NSString *stateWords(NSDictionary *row) {
  NSString *state = row[@"state"];
  if ([state isEqual:@"connected"]) return [row[@"lastSaid"] length] ? [NSString stringWithFormat:@"Connected · last call %@", row[@"lastSaid"]] : @"Connected";
  NSDictionary *words = @{@"added": @"Added, restart it", @"open": @"Not added", @"refused": @"Its settings file cannot be edited", @"absent": @"Not installed on this Mac", @"browser": @"Runs in a browser: nothing to add here"};
  return words[state] ?: @"";
}

static NSString *changeLine(NSDictionary *done) {
  NSDictionary *words = @{@"added": @"Added. Restart it to see the change.", @"replaced": @"Updated. Restart it to see the change.", @"removed": @"Removed. Restart it to see the change.", @"undone": @"Put back as it was."};
  return words[done[@"did"]] ?: @"";
}

static NSTextField *line(NSString *text, MVStyle style) {
  return MVParagraph(text, style);
}

/// A name is whatever a client calls itself: it may be empty, and its first letter may be more than one unit long.
static NSString *letterOf(NSString *name) {
  return name.length ? [name substringWithRange:[name rangeOfComposedCharacterSequenceAtIndex:0]].uppercaseString : @"?";
}

static NSString *shownName(NSDictionary *row) {
  return MVSaid(@{@"en": row[@"name"], @"tr": row[@"tr"] ?: row[@"name"]});
}

@implementation MVClientsPane {
  NSStackView *_here, *_browser;
  NSTextField *_awayNames;
  NSView *_awayGroup, *_hereGroup, *_browserGroup;
  NSTextField *_listening, *_tokenText;
  MVInk *_serverMark;
  NSButton *_power, *_showToken, *_copyToken, *_copyAddress;
  NSTimer *_timer;
  NSArray<NSDictionary *> *_rows;
  NSArray<NSString *> *_browserNames;
  NSDictionary *_preview;
  NSMutableDictionary<NSString *, NSDictionary *> *_told;
  NSMutableSet<NSString *> *_trying;
  NSMutableDictionary<NSString *, NSTextField *> *_stateLines;
  NSString *_address, *_token, *_failure, *_fresh;
  NSData *_drawn;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _told = [NSMutableDictionary dictionary];
    _stateLines = [NSMutableDictionary dictionary];
    _trying = [NSMutableSet set];
    _rows = @[];
    _here = MVPlaceColumn(@[], 0);
    _awayNames = MVParagraph(@"", MVStyleBody);
    _browser = MVPlaceColumn(@[], 0);
    _awayGroup = MVPlaceColumn(@[MVText(@"Not on This Mac", MVStyleHeading), MVCard(MVPlaceColumn(@[_awayNames, MVParagraph(@"Open one once, and it comes up above.", MVStyleSub)], 2), 10)], 6);
    _hereGroup = [self group:@"On This Mac" rows:_here];
    _browserGroup = [self group:@"In a Browser" rows:_browser];
    NSStackView *column = MVPlaceColumn(@[MVPlaceHead(@"sparkles", MVHueTile(3), @"AI Clients", @"Connect an AI app, and it can see and drive your devices."), _hereGroup, _awayGroup, _browserGroup, [self serverCard]], 8);
    [column setCustomSpacing:16 afterView:column.arrangedSubviews[0]];
    for (NSView *group in @[_hereGroup, _awayGroup, _browserGroup]) [column setCustomSpacing:16 afterView:group];
    NSScrollView *page = MVPlacePage(column);
    page.frame = self.bounds;
    page.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [self addSubview:page];
  }
  return self;
}

- (NSView *)group:(NSString *)title rows:(NSStackView *)rows {
  return MVPlaceColumn(@[MVText(title, MVStyleHeading), MVCard(rows, 0)], 6);
}

- (void)viewDidMoveToWindow {
  [_timer invalidate];
  _timer = nil;
  // a token shown is for the moment it was asked for
  _token = nil;
  [self showToken];
  if (!self.window) return;
  MVAskClients(@"list", @{});
  __weak MVClientsPane *weak = self;
  _timer = [NSTimer scheduledTimerWithTimeInterval:kListSeconds
                                           repeats:YES
                                             block:^(NSTimer *timer) {
                                               if (weak) MVAskClients(@"list", @{});
                                             }];
}

- (void)show:(NSDictionary *)message {
  if (message[@"serverFailed"]) _failure = [NSString stringWithFormat:@"The server could not start: %@", message[@"serverFailed"]];
  if (message[@"rows"]) {
    _rows = message[@"rows"];
    _browserNames = message[@"browser"] ?: @[];
    if (message[@"server"]) [self showServer:message[@"server"]];
    if (self.onNotes && message[@"notes"]) self.onNotes(message[@"notes"]);
  }
  if (message[@"preview"]) [self opened:message[@"preview"]];
  if (message[@"done"]) [self changed:message[@"done"]];
  if (message[@"tested"]) [self tested:message[@"tested"]];
  if (message[@"token"]) {
    _token = message[@"token"];
    [self showToken];
  }
  if (message[@"copy"]) [self copied:message[@"copy"]];
  if (self.onDoctor && message[@"doctor"]) self.onDoctor(message[@"doctor"]);
  [self drawRows];
}

- (void)opened:(NSDictionary *)preview {
  _preview = preview;
  _fresh = preview[@"client"];
  [_told removeObjectForKey:preview[@"client"]];
}

- (void)changed:(NSDictionary *)done {
  _preview = nil;
  _fresh = done[@"client"];
  _told[done[@"client"]] = @{@"line": changeLine(done), @"backup": done[@"backup"] ?: NSNull.null, @"ok": @YES};
  MVAnnounce(changeLine(done));
}

- (void)tested:(NSDictionary *)tested {
  [_trying removeObject:tested[@"client"]];
  _fresh = tested[@"client"];
  _told[tested[@"client"]] = tested;
  MVAnnounce(tested[@"said"]);
}

/// All a drawing depends on. How long ago a call was changes at every look, and goes straight into its label.
- (NSData *)drawing {
  NSMutableArray *rows = [NSMutableArray array];
  for (NSDictionary *row in _rows) {
    NSMutableDictionary *still = [row mutableCopy];
    [still removeObjectForKey:@"lastSaid"];
    [rows addObject:still];
  }
  return [NSJSONSerialization dataWithJSONObject:@[rows, _preview ?: @{}, _told, _trying.allObjects] options:NSJSONWritingSortedKeys error:NULL];
}

/// Rows are made again only when what they say changed: a look at the parent must not take a button from under a pointer.
- (void)drawRows {
  NSData *now = [self drawing];
  if ([now isEqual:_drawn]) {
    for (NSDictionary *row in _rows) _stateLines[row[@"name"]].stringValue = stateWords(row);
    return;
  }
  _drawn = now;
  [_stateLines removeAllObjects];
  NSMutableArray<NSView *> *here = [NSMutableArray array], *browser = [NSMutableArray array];
  NSMutableArray<NSString *> *away = [NSMutableArray array];
  for (NSDictionary *row in _rows) {
    if ([row[@"state"] isEqual:@"absent"]) [away addObject:shownName(row)];
    else [([_browserNames containsObject:row[@"name"]] ? browser : here) addObject:[self rowFor:row]];
  }
  [self fill:_here with:here];
  [self fill:_browser with:browser];
  _awayNames.stringValue = [away componentsJoinedByString:@", "];
  _awayGroup.hidden = away.count == 0;
  _hereGroup.hidden = here.count == 0;
  _browserGroup.hidden = browser.count == 0;
  _fresh = nil;
}

- (void)fill:(NSStackView *)rows with:(NSArray<NSView *> *)views {
  for (NSView *view in rows.arrangedSubviews) [view removeFromSuperview];
  [views enumerateObjectsUsingBlock:^(NSView *view, NSUInteger at, BOOL *stop) {
    if (at) [rows addArrangedSubview:MVSeparator()];
    [rows addArrangedSubview:view];
  }];
}

- (NSButton *)button:(NSString *)title do:(NSString *)what for:(NSString *)name {
  return MVPlaceButton(title, [NSString stringWithFormat:@"%@:%@", what, name], self, @selector(rowClicked:));
}

- (NSArray<NSButton *> *)buttonsOf:(NSDictionary *)row browser:(BOOL)browser {
  NSString *state = row[@"state"], *name = row[@"name"];
  NSMutableArray<NSButton *> *buttons = [NSMutableArray array];
  BOOL has = [state isEqual:@"connected"] || [state isEqual:@"added"];
  if (has || browser) {
    NSButton *test = [self button:[_trying containsObject:name] ? @"Testing…" : @"Test" do:@"test" for:name];
    test.enabled = ![_trying containsObject:name];
    [buttons addObject:test];
  }
  if (browser || !row[@"file"]) return buttons;
  if ([row[@"stale"] boolValue]) [buttons addObject:[self button:@"Update" do:@"add" for:name]];
  if (has) [buttons addObject:[self button:@"Remove" do:@"remove" for:name]];
  if ([state isEqual:@"open"]) {
    [buttons addObject:MVPlacePrimary(@"Add", [@"add:" stringByAppendingString:name], self, @selector(rowClicked:))];
  }
  return buttons;
}

- (NSView *)rowFor:(NSDictionary *)row {
  NSString *name = row[@"name"];
  BOOL browser = [_browserNames containsObject:name];
  // a hue of the palette's, by its name: no client's own colour stands here
  NSView *mark = MVLetterTile(letterOf(shownName(row)), MVHueTile((NSInteger)(shownName(row).hash % 6)), kTileSide);
  MVInk *state = [[MVInk alloc] initWithSymbol:symbolOf(row[@"state"]) color:colorOf(row[@"state"]) size:11];
  _stateLines[name] = MVText(stateWords(row), MVStyleSub);
  NSStackView *stateLine = [NSStackView stackViewWithViews:@[state, _stateLines[name]]];
  stateLine.spacing = 4;
  NSStackView *words = [NSStackView stackViewWithViews:@[MVText(shownName(row), MVStyleStrong), stateLine]];
  words.orientation = NSUserInterfaceLayoutOrientationVertical;
  words.alignment = NSLayoutAttributeLeading;
  words.spacing = 1;
  NSStackView *top = [NSStackView stackViewWithViews:@[mark, words]];
  top.spacing = 12;
  [words setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
  [top setHuggingPriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
  [top addView:[NSView new] inGravity:NSStackViewGravityTrailing];
  for (NSButton *button in [self buttonsOf:row browser:browser]) [top addView:button inGravity:NSStackViewGravityTrailing];
  [top.heightAnchor constraintGreaterThanOrEqualToConstant:kRowHigh].active = YES;
  NSMutableArray<NSView *> *parts = [NSMutableArray arrayWithObject:top];
  NSMutableArray<NSView *> *below = [NSMutableArray array];
  if ([_preview[@"client"] isEqual:name]) [below addObject:[self previewOf:_preview]];
  if (_told[name]) [below addObject:[self toldOf:_told[name] row:row]];
  if (row[@"why"]) [below addObject:line(row[@"why"], MVStyleSub)];
  if (below.count) {
    NSView *more = MVIndented(MVPlaceColumn(below, 6), kUnderName);
    [parts addObject:more];
    more.wantsLayer = YES;
    // only what just came: a row drawn again for another's sake stays as it stood
    if ([_fresh isEqual:name]) MVFade(more.layer, 0, 1, kShowSeconds);
  }
  NSStackView *all = MVPlaceColumn(parts, 6);
  all.edgeInsets = NSEdgeInsetsMake(0, 0, parts.count > 1 ? 10 : 0, 0);
  return all;
}

/// The exact lines, before anything happens to the file.
- (NSView *)previewOf:(NSDictionary *)preview {
  NSString *name = preview[@"client"];
  BOOL remove = [preview[@"remove"] boolValue], update = [preview[@"did"] isEqual:@"replaced"];
  NSString *lead = remove ? @"Takes this out of %@:" : update ? @"Changes this in %@:"
                                                              : @"Adds this to %@:";
  NSTextField *where = line([NSString stringWithFormat:lead, [preview[@"file"] stringByAbbreviatingWithTildeInPath]], MVStyleSub);
  NSView *lines = MVCard(MVCodeText([preview[@"lines"] componentsJoinedByString:@"\n"]), 8);
  NSTextField *promise = line([preview[@"backup"] boolValue] ? @"Only this entry changes, and a backup stays beside the file." : @"Only this entry changes.", MVStyleSub);
  NSStackView *buttons = [NSStackView stackViewWithViews:@[]];
  [buttons addView:[NSView new] inGravity:NSStackViewGravityLeading];
  NSButton *cancel = [self button:@"Cancel" do:@"cancel" for:name];
  cancel.keyEquivalent = @"\e";
  [buttons addView:cancel inGravity:NSStackViewGravityTrailing];
  NSButton *apply = MVPlacePrimary(remove ? @"Remove" : update ? @"Update"
                                                               : @"Add",
                                   [@"apply:" stringByAppendingString:name], self, @selector(rowClicked:));
  apply.keyEquivalent = @"\r";
  apply.hasDestructiveAction = remove;
  [buttons addView:apply inGravity:NSStackViewGravityTrailing];
  return MVPlaceColumn(@[where, lines, promise, buttons], 6);
}

/// What came of a change or a test: what it found and, where that is not the end of it, what to do next.
- (NSView *)toldOf:(NSDictionary *)told row:(NSDictionary *)row {
  NSMutableArray<NSView *> *parts = [NSMutableArray array];
  NSString *said = told[@"said"] ?: told[@"line"];
  BOOL ok = [told[@"ok"] boolValue];
  MVInk *mark = [[MVInk alloc] initWithSymbol:ok ? @"checkmark" : @"xmark.octagon.fill" color:ok ? MVGreen() : MVRed() size:12];
  NSTextField *words = line(said, MVStyleCallout);
  NSStackView *first = [NSStackView stackViewWithViews:@[mark, words]];
  first.spacing = 6;
  first.alignment = NSLayoutAttributeCenterY;
  if (row[@"undo"] && [row[@"undo"] boolValue] && told[@"line"]) [first addView:[self button:@"Undo" do:@"undo" for:row[@"name"]] inGravity:NSStackViewGravityTrailing];
  [parts addObject:first];
  if ([told[@"next"] length]) [parts addObject:line(told[@"next"], MVStyleSub)];
  if ([told[@"tail"] length]) [parts addObject:MVCard(MVCodeText(told[@"tail"]), 8)];
  if ([told[@"backup"] isKindOfClass:NSString.class]) [parts addObject:line([NSString stringWithFormat:@"Backup: %@", [told[@"backup"] stringByAbbreviatingWithTildeInPath]], MVStyleSub)];
  if (ok && row[@"check"] && ![row[@"state"] isEqual:@"open"]) [parts addObject:MVNoteText([NSString stringWithFormat:@"%@ %@", MVWord(@"To check:"), MVSaid(row[@"check"])])];
  return MVPlaceColumn(parts, 4);
}

- (void)rowClicked:(NSButton *)sender {
  NSRange split = [sender.identifier rangeOfString:@":"];
  NSString *what = [sender.identifier substringToIndex:split.location], *name = [sender.identifier substringFromIndex:NSMaxRange(split)];
  if ([what isEqual:@"cancel"]) {
    _preview = nil;
    return [self drawRows];
  }
  if ([what isEqual:@"add"] || [what isEqual:@"remove"]) return MVAskClients(@"preview", @{@"client": name, @"remove": @([what isEqual:@"remove"])});
  if ([what isEqual:@"apply"]) return MVAskClients(@"change", @{@"client": name, @"remove": _preview[@"remove"] ?: @NO});
  if ([what isEqual:@"undo"]) return MVAskClients(@"undo", @{@"client": name});
  if ([what isEqual:@"test"]) {
    [_trying addObject:name];
    [_told removeObjectForKey:name];
    [self drawRows];
    MVAskClients(@"test", @{@"client": name});
  }
}

- (NSView *)serverCard {
  _serverMark = [[MVInk alloc] initWithSymbol:@"circle" color:MVQuietColor() size:12];
  _listening = MVText(@"Off", MVStyleBody);
  _power = MVPlaceButton(@"Start Server", @"serverPower", self, @selector(powerClicked:));
  NSStackView *state = [NSStackView stackViewWithViews:@[_serverMark, _listening]];
  state.spacing = 8;
  [state addView:[NSView new] inGravity:NSStackViewGravityTrailing];
  [state addView:_power inGravity:NSStackViewGravityTrailing];
  _copyAddress = MVPlaceButton(@"Copy Address", @"copyAddress", self, @selector(copyAddress:));
  _copyAddress.hidden = YES;
  [state addView:_copyAddress inGravity:NSStackViewGravityTrailing];
  _tokenText = MVCodeText(@"");
  _showToken = MVPlaceButton(@"Show", @"showToken", self, @selector(tokenClicked:));
  _copyToken = MVPlaceButton(@"Copy", @"copyToken", self, @selector(copyToken:));
  NSButton *renew = MVPlaceButton(@"New Token", @"newToken", self, @selector(renewClicked:));
  NSStackView *token = [NSStackView stackViewWithViews:@[MVText(@"Token", MVStyleStrong), _tokenText]];
  token.spacing = 8;
  for (NSButton *button in @[_showToken, _copyToken, renew]) [token addView:button inGravity:NSStackViewGravityTrailing];
  [self showToken];
  NSStackView *all = MVPlaceColumn(@[state, token, MVText(@"What a token gives", MVStyleStrong), MVParagraph(@"Whoever has the address and the token drives your devices. Not just one app: they can read whatever a screen shows, type, install and remove apps, open links, change settings, and read and write files on this Mac where a tool takes a path.", MVStyleCallout), MVText(@"What a tunnel means", MVStyleStrong), MVParagraph(@"This server listens on this Mac alone, and a browser client runs in its maker's cloud. A tunnel, which you run and stop yourself, gives the server a public address. The client's maker sees what the tools return, so assume it sees the screen.", MVStyleCallout), MVParagraph(@"Use a test device with test accounts, and stop the tunnel when you are done. If the address or the token got out, make a new token.", MVStyleCallout), MVParagraph(@"One client at a time: once it has called a tool, it holds the server until 10 minutes after its last call.", MVStyleCallout)], 6);
  [all setCustomSpacing:12 afterView:token];
  [all setCustomSpacing:12 afterView:all.arrangedSubviews[3]];
  return MVCard(all, 12);
}

- (void)showServer:(NSDictionary *)server {
  _address = server[@"address"];
  BOOL on = _address.length > 0;
  [_serverMark paint:on ? @"circle.fill" : @"circle" color:on ? MVGreen() : MVQuietColor()];
  if (on) _failure = nil;
  _listening.stringValue = on ? [NSString stringWithFormat:@"Listening on %@", _address] : _failure ?
                                                                                                    : @"Off";
  BOOL starting = [server[@"starting"] boolValue];
  _power.title = MVWord(on ? @"Stop Server" : starting ? @"Starting…"
                                                       : @"Start Server");
  _power.enabled = !starting;
  _copyAddress.hidden = !on;
}

- (void)showToken {
  _tokenText.stringValue = _token ?: @"••••••••••••••••••••••••";
  _showToken.title = MVWord(_token ? @"Hide" : @"Show");
  _tokenText.accessibilityLabel = MVWord(_token ? @"Token" : @"Token, hidden");
}

- (void)powerClicked:(id)sender {
  _failure = nil;
  MVAskClients(_address.length ? @"stop" : @"start", @{});
}

- (void)tokenClicked:(id)sender {
  if (!_token) return MVAskClients(@"token", @{});
  _token = nil;
  [self showToken];
}

- (void)copyToken:(id)sender {
  MVAskClients(@"copyToken", @{});
}

- (void)renewClicked:(id)sender {
  _token = nil;
  [self showToken];
  MVAskClients(@"renewToken", @{});
}

- (void)copyAddress:(NSButton *)sender {
  if (!_address) return;
  MVCopyText(_address, MVPlaceBoard());
  MVSayCopied(sender);
}

/// A clipboard manager is asked not to keep this.
- (void)copied:(NSString *)text {
  NSPasteboard *board = MVPlaceBoard();
  MVCopyText(text, board);
  [board setString:@"" forType:@"org.nspasteboard.ConcealedType"];
  MVSayCopied(_copyToken);
}

@end
