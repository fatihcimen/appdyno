// What a person does with the requests of the Network pane beyond reading them: narrow the list, copy one as a
// command, make a rule of its answer, keep the capture as a file, empty the list, and choose to see what was sent as
// it was sent. That choice is held here while the window is open and nowhere else: an agent's answers stay cleaned.
#import "Place.h"
#import "Window.h"
#import "Words.h"

@interface MVNetworkActions () <NSTextFieldDelegate>
@end

@implementation MVNetworkActions {
  NSTextField *_field;
  NSButton *_curl, *_mock, *_real;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _field = MVSendField(@"networkFilter", @"Filter by address, method or status", @"Filter", self, @selector(changed:));
    _field.delegate = self;
    _curl = MVPlaceButton(@"Copy as cURL", @"networkCurl", self, @selector(pressed:));
    _mock = MVPlaceButton(@"Mock This Answer", @"networkMockFrom", self, @selector(pressed:));
    NSButton *save = MVPlaceButton(@"Save HAR", @"networkSave", self, @selector(pressed:));
    NSButton *clear = MVPlaceButton(@"Clear", @"networkClear", self, @selector(pressed:));
    _real = [NSButton checkboxWithTitle:MVWord(@"Show real values") target:self action:@selector(changed:)];
    _real.identifier = @"networkReal";
    _real.toolTip = MVWord(@"Shows headers, cookies and bodies as they were sent, here only. An AI client still gets them hidden.");
    MVPaneFill(self, @[MVFieldPlate(_field, nil), MVPaneRow(@[_curl, _mock]), MVPaneRow(@[save, clear, _real])], 6);
    self.hasRequest = NO;
  }
  return self;
}

- (NSString *)filter {
  return [_field.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
}

- (BOOL)real {
  return _real.state == NSControlStateValueOn;
}

/// A request is chosen: what is done to one can be.
- (void)setHasRequest:(BOOL)hasRequest {
  _hasRequest = hasRequest;
  _curl.enabled = _mock.enabled = hasRequest;
}

- (void)controlTextDidChange:(NSNotification *)note {
  [self changed:nil];
}

- (void)changed:(id)sender {
  if (self.onChange) self.onChange();
}

/// By the name the button is found by, which is the control the parent takes.
- (void)pressed:(NSButton *)sender {
  if (self.onPress) self.onPress(sender.identifier);
}

/// The parent's command for the request chosen: copied, and said to be.
- (void)copied:(NSString *)text {
  MVCopyText(text, MVPlaceBoard());
  MVSayCopied(_curl);
}

@end
