// Connect a Phone's card for going without a cable: what `appdyno pair` needs of a person, and nothing the list or the bar over
// a device already says.
#import "Place.h"
#import "Words.h"

static const CGFloat kAddressWide = 180, kCodeWide = 80;
static const NSUInteger kCodeDigits = 6;

@implementation MVWifiCard {
  NSTextField *_say, *_said, *_address, *_code;
  NSStackView *_fields;
  NSButton *_forget, *_pair;
  NSString *_serial;
  NSDictionary *_wifi;
  BOOL _pairing;
}

- (instancetype)init {
  if ((self = [super init])) {
    _say = MVParagraph(@"", MVStyleCallout);
    _said = MVParagraph(@"", MVStyleSub);
    _address = [NSTextField textFieldWithString:@""];
    _address.identifier = @"wifiAddress";
    _address.placeholderString = MVWord(@"Address and port");
    _code = [NSTextField textFieldWithString:@""];
    _code.identifier = @"wifiCode";
    _code.placeholderString = MVWord(@"Code");
    NSView *addressPlate = MVFieldPlate(_address, nil), *codePlate = MVFieldPlate(_code, nil);
    [addressPlate.widthAnchor constraintEqualToConstant:kAddressWide].active = YES;
    [codePlate.widthAnchor constraintEqualToConstant:kCodeWide].active = YES;
    _fields = [NSStackView stackViewWithViews:@[addressPlate, codePlate]];
    _fields.spacing = 8;
    // one colour on a screen, and the step above is what a person came for
    _pair = MVPlaceButton(@"Pair for Wi-Fi", @"pairWifi", self, @selector(pair:));
    _forget = MVPlaceButton(@"Forget Pairing", @"forgetWifi", self, @selector(forget:));
    NSView *head = MVPlaceRow(MVText(@"Without a Cable", MVStyleStrong), @[_forget, _pair]);
    _view = MVCard(MVPlaceColumn(@[head, _say, _fields, _said], 6), 12);
    _view.hidden = YES;
  }
  return self;
}

- (BOOL)byCode {
  return [_wifi[@"way"] isEqual:@"code"];
}

- (void)show:(NSDictionary *)guide {
  _wifi = guide[@"wifi"];
  _serial = guide[@"serial"];
  _view.hidden = _wifi == nil;
  [self draw];
}

- (void)draw {
  BOOL paired = [_wifi[@"paired"] boolValue];
  NSString *words = @"Pair this iPhone once, while it is on this cable and unlocked. After that it shows here by Wi-Fi, on this Mac's network.";
  if (self.byCode) words = paired ? @"Paired for Wi-Fi. Unplug it, and it stays in the list while Wireless debugging is on." : @"On the phone: Settings, Developer options, Wireless debugging, Pair device with pairing code. Type here what it shows.";
  else if (paired) words = @"Paired for Wi-Fi. Unplug it, and it stays in the list while it is on this Mac's network.";
  _say.stringValue = MVWord(words);
  _fields.hidden = paired || !self.byCode;
  _pair.hidden = paired;
  _pair.enabled = !_pairing;
  // an Android phone's pairing is kept on the phone, and forgotten there
  _forget.hidden = !paired || self.byCode;
  _said.hidden = !_said.stringValue.length;
}

- (void)heard:(NSDictionary *)run {
  if (![@[@"pair", @"forget"] containsObject:run[@"name"]]) return;
  if (run[@"started"]) {
    _pairing = YES;
    _said.stringValue = @"";
  }
  for (NSString *line in [run[@"text"] componentsSeparatedByCharactersInSet:NSCharacterSet.newlineCharacterSet])
    if (line.length) _said.stringValue = MVWord(line);
  if (run[@"code"]) {
    _pairing = NO;
    if ([run[@"code"] intValue] == 0) _said.stringValue = _code.stringValue = @"";
    MVAskClients(@"connect", @{@"fresh": @YES});
  }
  [self draw];
}

- (void)pair:(id)sender {
  if (!self.byCode) return MVAskClients(@"run", @{@"name": @"pair", @"device": _serial ?: @""});
  if (!_address.stringValue.length || _code.stringValue.length != kCodeDigits) {
    _said.stringValue = MVWord(@"Type the address and the six digits the phone shows.");
    return [self draw];
  }
  MVAskClients(@"run", @{@"name": @"pair", @"address": _address.stringValue, @"code": _code.stringValue});
}

- (void)forget:(id)sender {
  MVAskClients(@"run", @{@"name": @"forget", @"device": _serial ?: @""});
}

@end
