// What sits over the picture and beside it: the mark that an agent is driving, a request for a person, and
// the activity of the calls. All of it for a person's eyes; none of it touches the device.
#import "Viewer.h"

enum { kActivityLines = 200 };

static NSView *pillView(NSTextField *text) {
  NSView *pill = [NSView new];
  pill.wantsLayer = YES;
  pill.layer.backgroundColor = [NSColor colorWithRed:0.45 green:0.25 blue:0.85 alpha:0.9].CGColor;
  pill.layer.cornerRadius = 10;
  pill.translatesAutoresizingMaskIntoConstraints = NO;
  text.translatesAutoresizingMaskIntoConstraints = NO;
  [pill addSubview:text];
  [NSLayoutConstraint activateConstraints:@[
    [text.leadingAnchor constraintEqualToAnchor:pill.leadingAnchor constant:10],
    [text.trailingAnchor constraintEqualToAnchor:pill.trailingAnchor constant:-10],
    [text.topAnchor constraintEqualToAnchor:pill.topAnchor constant:3],
    [text.bottomAnchor constraintEqualToAnchor:pill.bottomAnchor constant:-3],
  ]];
  return pill;
}

static NSTextField *whiteLabel(CGFloat size) {
  NSTextField *field = [NSTextField labelWithString:@""];
  field.font = [NSFont systemFontOfSize:size weight:NSFontWeightMedium];
  field.textColor = NSColor.whiteColor;
  field.lineBreakMode = NSLineBreakByTruncatingTail;
  return field;
}

@implementation MVOverlay {
  __weak NSView *_view;
  NSView *_pill;
  NSTextField *_pillText;
  NSVisualEffectView *_banner;
  NSTextField *_bannerText;
  NSString *_bannerId;
  NSPanel *_panel;
  NSTextView *_log;
  NSMutableArray<NSString *> *_lines;
}

- (instancetype)initInView:(NSView *)view {
  if ((self = [super init])) {
    _view = view;
    _lines = [NSMutableArray array];
    _pillText = whiteLabel(11);
    _pill = pillView(_pillText);
    _pill.hidden = YES;
    [view addSubview:_pill];
    [NSLayoutConstraint activateConstraints:@[
      [_pill.topAnchor constraintEqualToAnchor:view.topAnchor constant:8],
      [_pill.centerXAnchor constraintEqualToAnchor:view.centerXAnchor],
      [_pill.widthAnchor constraintLessThanOrEqualToAnchor:view.widthAnchor constant:-16],
    ]];
  }
  return self;
}

- (void)setDriving:(BOOL)driving tool:(NSString *)tool {
  _pillText.stringValue = tool.length ? [NSString stringWithFormat:@"Agent driving: %@", tool] : @"Agent driving";
  _pill.hidden = !driving;
}

- (void)showBanner:(NSDictionary *)m {
  [self hideBanner];
  NSView *view = _view;
  if (!view) return;
  _bannerId = m[@"id"];
  _banner = [NSVisualEffectView new];
  _banner.material = NSVisualEffectMaterialHUDWindow;
  _banner.blendingMode = NSVisualEffectBlendingModeWithinWindow;
  _banner.state = NSVisualEffectStateActive;
  _banner.wantsLayer = YES;
  _banner.layer.cornerRadius = 10;
  _banner.translatesAutoresizingMaskIntoConstraints = NO;
  _bannerText = [NSTextField wrappingLabelWithString:m[@"text"] ?: @"A person is needed"];
  _bannerText.alignment = NSTextAlignmentCenter;
  NSMutableArray<NSView *> *parts = [NSMutableArray arrayWithObject:_bannerText];
  if ([m[@"needsDone"] boolValue]) [parts addObject:[NSButton buttonWithTitle:@"I'm Done" target:self action:@selector(done:)]];
  NSStackView *stack = [NSStackView stackViewWithViews:parts];
  stack.orientation = NSUserInterfaceLayoutOrientationVertical;
  stack.translatesAutoresizingMaskIntoConstraints = NO;
  [_banner addSubview:stack];
  [view addSubview:_banner];
  [NSLayoutConstraint activateConstraints:@[
    [_banner.bottomAnchor constraintEqualToAnchor:view.bottomAnchor constant:-12],
    [_banner.leadingAnchor constraintEqualToAnchor:view.leadingAnchor constant:10],
    [_banner.trailingAnchor constraintEqualToAnchor:view.trailingAnchor constant:-10],
    [stack.leadingAnchor constraintEqualToAnchor:_banner.leadingAnchor constant:10],
    [stack.trailingAnchor constraintEqualToAnchor:_banner.trailingAnchor constant:-10],
    [stack.topAnchor constraintEqualToAnchor:_banner.topAnchor constant:10],
    [stack.bottomAnchor constraintEqualToAnchor:_banner.bottomAnchor constant:-10],
  ]];
  if ([m[@"sound"] boolValue]) {
    [[NSSound soundNamed:@"Glass"] play];
    [NSApp requestUserAttention:NSCriticalRequest];
  }
}

- (void)hideBanner {
  [_banner removeFromSuperview];
  _banner = nil;
  _bannerId = nil;
}

- (void)done:(id)sender {
  if (_bannerId) MVEmit(@{@"op": @"done", @"id": _bannerId});
  [self hideBanner];
}

- (void)addActivity:(NSString *)line {
  [_lines addObject:line];
  if (_lines.count > kActivityLines) [_lines removeObjectAtIndex:0];
  if (_panel.isVisible) [self showLines];
}

- (void)showLines {
  _log.string = [_lines componentsJoinedByString:@"\n"];
  [_log scrollToEndOfDocument:nil];
}

- (void)toggleActivity {
  if (!_panel) {
    _panel = [[NSPanel alloc] initWithContentRect:NSMakeRect(120, 120, 420, 320) styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable | NSWindowStyleMaskUtilityWindow backing:NSBackingStoreBuffered defer:NO];
    _panel.title = @"Activity";
    _panel.releasedWhenClosed = NO;
    NSScrollView *scroll = [NSTextView scrollableTextView];
    _log = scroll.documentView;
    _log.editable = NO;
    _log.font = [NSFont monospacedSystemFontOfSize:11 weight:NSFontWeightRegular];
    _panel.contentView = scroll;
  }
  if (_panel.isVisible) return [_panel orderOut:nil];
  [self showLines];
  [_panel orderFront:nil];
}

@end
