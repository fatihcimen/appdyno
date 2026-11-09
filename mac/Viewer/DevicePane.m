// The Device pane: the device's conditions as it reads them, each changed by `device_setting` or `set_location`, the ops an
// agent calls, so that one record holds what goes back, whoever changed it. What this device cannot do stands disabled with
// the device's own reason, and what a person changes here goes back when the device leaves the window.
#import "Place.h"
#import "Window.h"
#import "Words.h"

static const double kBetween = 10, kHeadingGap = 18;

/// The rows' column, from its top.
@interface MVDeviceColumn : NSView
@end

@implementation MVDeviceColumn
- (BOOL)isFlipped {
  return YES;
}
@end

@interface MVDevicePane () <MVConditionTarget>
@end

@implementation MVDevicePane {
  NSArray<MVConditionRow *> *_ordered;
  NSMutableDictionary<NSString *, MVConditionRow *> *_rows;
  NSTextField *_reading;
  NSButton *_back;
  NSDictionary *_asked;
  NSSet<NSString *> *_changedBefore;
  BOOL _android;
}

@synthesize onSend = _onSend, answer = _answer;

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _rows = [NSMutableDictionary dictionary];
    _reading = MVPaneNote(@"Reading the device");
    NSTextField *back = MVPaneNote(@"What you change here goes back when the device leaves this window.");
    NSStackView *column = MVPlaceColumn(@[back, _reading], 8);
    [column setCustomSpacing:kHeadingGap afterView:back];
    _ordered = [MVConditionRow rowsFor:self];
    for (MVConditionRow *row in _ordered) {
      _rows[row.name] = row;
      if (row.heading) {
        // a heading stands nearer what it heads than what went before
        [column setCustomSpacing:kHeadingGap afterView:column.arrangedSubviews.lastObject];
        NSTextField *heading = MVPaneHeading(row.heading);
        [column addArrangedSubview:heading];
        [column setCustomSpacing:6 afterView:heading];
      }
      [column addArrangedSubview:row.view];
    }
    NSScrollView *scroll = [self scrolling:column];
    _answer = [MVAnswerView new];
    _back = MVPlaceButton(@"Put Back All", @"deviceBack", self, @selector(putBack:));
    // the pane's one button, at its trailing edge, as a sheet's are
    NSStackView *end = [NSStackView new];
    [end addView:_back inGravity:NSStackViewGravityTrailing];
    NSStackView *foot = MVPlaceColumn(@[MVSeparator(), _answer, end], 8);
    for (NSView *part in @[scroll, foot]) {
      part.translatesAutoresizingMaskIntoConstraints = NO;
      [self addSubview:part];
      [part.leadingAnchor constraintEqualToAnchor:self.leadingAnchor].active = YES;
      [part.trailingAnchor constraintEqualToAnchor:self.trailingAnchor].active = YES;
    }
    [NSLayoutConstraint activateConstraints:@[
      [scroll.topAnchor constraintEqualToAnchor:self.topAnchor],
      [foot.topAnchor constraintEqualToAnchor:scroll.bottomAnchor
                                     constant:kBetween],
      [foot.bottomAnchor constraintEqualToAnchor:self.bottomAnchor],
    ]];
    [self enable:NO];
  }
  return self;
}

/// The column in what room the pane has, scrolled when it runs past it, as wide as the pane.
- (NSScrollView *)scrolling:(NSView *)column {
  NSScrollView *scroll = [NSScrollView new];
  scroll.drawsBackground = NO;
  scroll.hasVerticalScroller = YES;
  scroll.autohidesScrollers = YES;
  NSView *page = [MVDeviceColumn new];
  page.translatesAutoresizingMaskIntoConstraints = NO;
  column.translatesAutoresizingMaskIntoConstraints = NO;
  [page addSubview:column];
  scroll.documentView = page;
  NSClipView *clip = scroll.contentView;
  [NSLayoutConstraint activateConstraints:@[
    [page.topAnchor constraintEqualToAnchor:clip.topAnchor],
    [page.leadingAnchor constraintEqualToAnchor:clip.leadingAnchor],
    [page.widthAnchor constraintEqualToAnchor:clip.widthAnchor],
    [column.topAnchor constraintEqualToAnchor:page.topAnchor],
    [column.leadingAnchor constraintEqualToAnchor:page.leadingAnchor],
    [column.trailingAnchor constraintEqualToAnchor:page.trailingAnchor],
    [column.bottomAnchor constraintEqualToAnchor:page.bottomAnchor],
  ]];
  return scroll;
}

/// Every condition as the device reads it now, asked again each time the pane shows: an agent may have changed any.
- (void)ask {
  MVPaneSend(self, @{@"op": @"control", @"name": @"deviceList"});
}

/// Nothing here takes the keyboard first: a switch needs none.
- (void)focus {
}

- (void)setPlatform:(NSString *)platform {
  BOOL android = [platform isEqual:@"android"];
  if (android == _android && [(NSPopUpButton *)_rows[@"text_size"].control numberOfItems]) return;
  _android = android;
  for (MVConditionRow *row in _ordered)
    if (row.kind == MVRowChoice) [row offerChoices:android];
}

- (void)show:(NSDictionary *)m {
  if ([m[@"platform"] isKindOfClass:NSString.class]) [self setPlatform:m[@"platform"]];
  for (NSDictionary *said in [m[@"conditions"] isKindOfClass:NSArray.class] ? m[@"conditions"] : @[])
    if ([said isKindOfClass:NSDictionary.class]) _rows[said[@"name"]].said = said;
  // every control back to what the device last read: one a person moved while another change was on its way too
  for (MVConditionRow *row in _ordered) [row fill];
  if (m[@"conditions"]) _reading.hidden = YES;
  NSDictionary *asked = _asked;
  if (m[@"ok"]) _asked = nil;
  [_answer show:[m[@"ok"] boolValue] && asked ? [self done:asked said:m] : m];
  [self enable:!_answer.waiting];
}

/// What was done, in a person's words; the op's own stay for what went wrong.
- (NSDictionary *)done:(NSDictionary *)asked said:(NSDictionary *)m {
  NSMutableDictionary *said = [m mutableCopy];
  MVConditionRow *row = _rows[asked[@"name"]];
  NSString *value = asked[@"value"];
  NSString *words = nil;
  if ([asked[@"what"] isEqual:@"deviceRestore"]) {
    NSMutableArray<NSString *> *back = [NSMutableArray array];
    BOOL left = NO;
    for (MVConditionRow *each in _ordered) {
      if ([_changedBefore containsObject:each.name] && !each.changed) [back addObject:each.title];
      left = left || each.changed;
    }
    // what could not go back, or another program's, is said by the op whole
    if (left) return m;
    words = back.count ? MVFormat(@"Put back: %@", @[[back componentsJoinedByString:@", "]]) : MVWord(@"Nothing here was changed");
  } else if ([asked[@"what"] isEqual:@"deviceLocation"])
    words = MVWord(value ? @"The location is the real one again" : @"The location is set");
  else if (row.kind == MVRowBiometric)
    words = MVWord([value isEqual:@"match"] ? @"Answered with a match" : @"Answered with no match");
  else if (row.kind == MVRowCall)
    words = MVFormat([value hasPrefix:@"end "] ? @"The call from %@ ended" : @"A call from %@ is coming in", @[asked[@"number"] ?: @""]);
  else if (row.kind == MVRowSms)
    words = MVWord(@"The message came in");
  else
    words = MVFormat([m[@"moved"] boolValue] ? @"%@ is now %@" : @"%@ already reads %@", @[row.title, row.state]);
  said[@"text"] = words;
  [said removeObjectForKey:@"hint"];
  return said;
}

/// One change at a time, each control standing as the device last read it until its answer comes.
- (void)enable:(BOOL)on {
  BOOL changed = NO;
  for (MVConditionRow *row in _ordered) {
    [row enable:on];
    changed = changed || row.changed;
  }
  _back.enabled = on && changed;
}

- (void)send:(NSString *)what args:(NSDictionary *)args asked:(NSDictionary *)asked saying:(NSString *)words {
  if (_answer.waiting) return;
  NSMutableDictionary *all = [asked mutableCopy];
  all[@"what"] = what;
  _asked = all;
  [self enable:NO];
  [_answer sending:words];
  MVPaneSend(self, @{@"op": @"control", @"name": what, @"args": args});
}

- (MVConditionRow *)rowOf:(NSControl *)control {
  NSArray<NSString *> *parts = [control.identifier componentsSeparatedByString:@":"];
  return _rows[parts.count > 1 && [parts[0] isEqual:@"condition"] ? parts[1] : parts.firstObject];
}

/// A condition to a value, as the op takes it.
- (void)set:(MVConditionRow *)row value:(NSString *)value {
  [self send:@"deviceSet" args:@{@"name": row.name, @"value": value} asked:@{@"name": row.name, @"value": value} saying:MVFormat(@"Setting %@", @[row.title])];
}

- (void)switched:(NSSwitch *)sender {
  [self set:[self rowOf:sender] value:sender.state == NSControlStateValueOn ? @"on" : @"off"];
}

- (void)chosen:(NSPopUpButton *)sender {
  [self set:[self rowOf:sender] value:sender.selectedItem.representedObject ?: @""];
}

- (void)typed:(NSTextField *)sender {
  MVConditionRow *row = [self rowOf:sender];
  NSString *text = [row.field.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if (row.kind == MVRowField) return [self set:row value:text.length || ![row.name isEqual:@"proxy"] ? text : @"none"];
  if (row.kind == MVRowLocation) return [self locate:text];
  if (row.kind == MVRowCall) return [self call:text end:NO];
  [self message];
}

- (void)pressed:(NSButton *)sender {
  MVConditionRow *row = [self rowOf:sender];
  NSString *what = [sender.identifier componentsSeparatedByString:@":"].lastObject;
  NSString *number = [row.field.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
  if (row.kind == MVRowBiometric)
    [self send:@"deviceSet" args:@{@"name": @"biometric", @"value": what} asked:@{@"name": row.name, @"value": what} saying:MVWord([NSString stringWithFormat:@"Sending %@", sender.title])];
  else if (row.kind == MVRowLocation)
    [self send:@"deviceLocation" args:@{@"clear": @YES} asked:@{@"name": row.name, @"value": @"clear"} saying:MVWord(@"Setting the location")];
  else if (row.kind == MVRowCall)
    [self call:number end:[what isEqual:@"end"]];
  else
    [self message];
}

/// A place by its latitude and longitude, as a map writes them.
- (void)locate:(NSString *)text {
  NSArray<NSString *> *parts = [text componentsSeparatedByString:@","];
  NSNumberFormatter *number = [NSNumberFormatter new];
  number.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
  NSNumber *lat = parts.count == 2 ? [number numberFromString:[parts[0] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet]] : nil;
  NSNumber *lon = parts.count == 2 ? [number numberFromString:[parts[1] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet]] : nil;
  if (!lat || !lon) return [_answer show:@{@"ok": @NO, @"text": MVWord(@"Give a latitude and a longitude, such as 41.0082, 28.9784")}];
  [self send:@"deviceLocation" args:@{@"lat": lat, @"lon": lon} asked:@{@"name": @"location"} saying:MVWord(@"Setting the location")];
}

- (void)call:(NSString *)number end:(BOOL)end {
  NSString *value = end ? [@"end " stringByAppendingString:number] : number;
  [self send:@"deviceSet" args:@{@"name": @"call", @"value": value} asked:@{@"name": @"call", @"value": value, @"number": number} saying:MVWord([NSString stringWithFormat:@"Sending %@", _rows[@"call"].title])];
}

- (void)message {
  MVConditionRow *row = _rows[@"sms"];
  NSString *from = [row.from.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
  // an empty field sends what it shows greyed, in the window's language
  NSString *words = row.field.stringValue.length ? row.field.stringValue : MVWord(@"Sent from the window");
  NSMutableDictionary *args = [NSMutableDictionary dictionaryWithDictionary:@{@"name": @"sms", @"value": words}];
  if (from.length) args[@"title"] = from;
  [self send:@"deviceSet" args:args asked:@{@"name": @"sms"} saying:MVWord([NSString stringWithFormat:@"Sending %@", row.title])];
}

/// Everything this session changed, by `device_setting restore`: what another program changed stays, as it puts it back.
- (void)putBack:(id)sender {
  NSMutableSet<NSString *> *changed = [NSMutableSet set];
  for (MVConditionRow *row in _ordered)
    if (row.changed) [changed addObject:row.name];
  _changedBefore = changed;
  [self send:@"deviceRestore" args:@{} asked:@{} saying:MVWord(@"Putting back what changed")];
}

- (void)set:(NSString *)name to:(NSString *)value {
  MVConditionRow *row = _rows[name];
  if (row.kind == MVRowSwitch) {
    [(NSSwitch *)row.control setState:[value isEqual:@"on"] ? NSControlStateValueOn : NSControlStateValueOff];
    return [self switched:(NSSwitch *)row.control];
  }
  if (row.kind == MVRowChoice) {
    NSPopUpButton *choice = (NSPopUpButton *)row.control;
    NSInteger at = [choice indexOfItemWithRepresentedObject:value];
    if (at >= 0) [choice selectItemAtIndex:at];
    return [self chosen:choice];
  }
  row.field.stringValue = value;
  [self typed:row.field];
}

- (NSString *)shown:(NSString *)name {
  return _rows[name].shown;
}

@end
