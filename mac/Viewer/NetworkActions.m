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
  NSButton *_curl, *_mock, *_real, *_save, *_clear;
  NSTextField *_ended;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _field = MVSendField(@"networkFilter", @"Filter by address, method or status", @"Filter", self, @selector(changed:));
    _field.delegate = self;
    _curl = MVPlaceButton(@"Copy as cURL", @"networkCurl", self, @selector(pressed:));
    _mock = MVPlaceButton(@"Mock This Answer", @"networkMockFrom", self, @selector(pressed:));
    _save = MVPlaceButton(@"Save HAR", @"networkSave", self, @selector(pressed:));
    _clear = MVPlaceButton(@"Clear", @"networkClear", self, @selector(pressed:));
    _ended = MVPaneNote(@"The capture has ended. Its requests can still be searched; copying, mocking and saving need a capture that runs.");
    _ended.maximumNumberOfLines = 0;
    _ended.hidden = YES;
    _real = [NSButton checkboxWithTitle:MVWord(@"Show real values") target:self action:@selector(changed:)];
    _real.identifier = @"networkReal";
    _real.toolTip = MVWord(@"Shows headers, cookies and bodies as they were sent, here only. An AI client still gets them hidden.");
    MVPaneFill(self, @[MVFieldPlate(_field, nil), MVPaneRow(@[_curl, _mock]), MVPaneRow(@[_save, _clear, _real]), _ended], 6);
    _live = YES;
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
  _curl.enabled = _mock.enabled = hasRequest && _live;
}

/// What reads the capture itself needs one that runs: with none, each is off and the pane says why, and the words that
/// narrow the list go on working, as they are the window's own.
- (void)setLive:(BOOL)live {
  _live = live;
  _save.enabled = _clear.enabled = _real.enabled = live;
  _ended.hidden = live;
  for (NSButton *button in @[_curl, _mock, _save, _clear]) button.toolTip = live ? nil : _ended.stringValue;
  _real.toolTip = live ? MVWord(@"Shows headers, cookies and bodies as they were sent, here only. An AI client still gets them hidden.") : _ended.stringValue;
  self.hasRequest = _hasRequest;
}

- (NSString *)ended {
  return _ended.hidden ? @"" : _ended.stringValue;
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
