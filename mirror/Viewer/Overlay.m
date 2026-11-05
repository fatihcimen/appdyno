// What sits over the picture, for a person's eyes: how the stream is, and a request for a person. None of it
// touches the device, and a click anywhere but on its button goes to the picture.
#import "Viewer.h"
#import "Window.h"
#import "Words.h"

static const double kCardWidth = 264, kInset = 16, kRing = 44, kRingSeconds = 0.6;

/// A click on it is the picture's, even with a card showing; only a button is its own.
@interface MVCard : NSVisualEffectView
@end

@implementation MVCard
- (NSView *)hitTest:(NSPoint)point {
  NSView *hit = [super hitTest:point];
  return [hit isKindOfClass:NSButton.class] ? hit : nil;
}
@end

static NSImageView *symbol(NSString *name, NSColor *tint) {
  NSImage *image = [NSImage imageWithSystemSymbolName:name accessibilityDescription:nil];
  NSImageView *view = [NSImageView imageViewWithImage:[image imageWithSymbolConfiguration:[NSImageSymbolConfiguration configurationWithPointSize:24 weight:NSFontWeightRegular]]];
  view.contentTintColor = tint;
  return view;
}

static NSTextField *words(NSString *text, CGFloat size, NSFontWeight weight, NSColor *color) {
  NSTextField *field = [NSTextField wrappingLabelWithString:MVWord(text)];
  field.font = [NSFont systemFontOfSize:size weight:weight];
  field.textColor = color;
  field.alignment = NSTextAlignmentCenter;
  field.selectable = NO;
  field.drawsBackground = NO;
  field.preferredMaxLayoutWidth = kCardWidth - 2 * kInset;
  return field;
}

/// A card of the window's own material, always in its dark form: it sits on a dimmed picture.
static MVCard *card(NSArray<NSView *> *parts) {
  MVCard *box = [MVCard new];
  box.material = NSVisualEffectMaterialHUDWindow;
  box.blendingMode = NSVisualEffectBlendingModeWithinWindow;
  box.state = NSVisualEffectStateActive;
  box.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  box.wantsLayer = YES;
  box.layer.cornerRadius = 14;
  box.layer.masksToBounds = YES;
  box.translatesAutoresizingMaskIntoConstraints = NO;
  NSStackView *stack = [NSStackView stackViewWithViews:parts];
  stack.orientation = NSUserInterfaceLayoutOrientationVertical;
  stack.spacing = 8;
  stack.translatesAutoresizingMaskIntoConstraints = NO;
  [box addSubview:stack];
  [NSLayoutConstraint activateConstraints:@[
    [stack.leadingAnchor constraintEqualToAnchor:box.leadingAnchor constant:kInset],
    [stack.trailingAnchor constraintEqualToAnchor:box.trailingAnchor constant:-kInset],
    [stack.topAnchor constraintEqualToAnchor:box.topAnchor constant:kInset],
    [stack.bottomAnchor constraintEqualToAnchor:box.bottomAnchor constant:-kInset],
  ]];
  return box;
}

static void place(NSView *box, NSView *view, NSLayoutConstraint *vertical) {
  [view addSubview:box];
  NSLayoutConstraint *wide = [box.widthAnchor constraintEqualToConstant:kCardWidth];
  wide.priority = NSLayoutPriorityDefaultHigh;
  [NSLayoutConstraint activateConstraints:@[
    vertical,
    wide,
    [box.centerXAnchor constraintEqualToAnchor:view.centerXAnchor],
    [box.widthAnchor constraintLessThanOrEqualToAnchor:view.widthAnchor constant:-24],
  ]];
}

/// What a state of the stream looks like.
static NSString *symbolOf(NSString *state) {
  if ([state isEqual:@"waiting"]) return @"pause.circle";
  if ([state isEqual:@"stopped"]) return @"exclamationmark.triangle";
  return @"arrow.triangle.2.circlepath";
}

@implementation MVOverlay {
  __weak NSView *_view;
  MVCard *_stateCard, *_banner;
  NSString *_bannerId;
}

- (instancetype)initInView:(NSView *)view {
  if ((self = [super init])) _view = view;
  return self;
}

- (void)showTouchAtX:(double)x y:(double)y {
  CALayer *ring = [CALayer layer];
  CGSize size = _view.bounds.size;
  ring.frame = CGRectMake(x * size.width - kRing / 2, (1 - y) * size.height - kRing / 2, kRing, kRing);
  ring.cornerRadius = kRing / 2;
  ring.borderWidth = 2.5;
  ring.borderColor = NSColor.controlAccentColor.CGColor;
  ring.backgroundColor = [NSColor.controlAccentColor colorWithAlphaComponent:0.25].CGColor;
  [_view.layer addSublayer:ring];
  if (!NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion) {
    CABasicAnimation *fade = [CABasicAnimation animationWithKeyPath:@"opacity"];
    fade.fromValue = @1;
    fade.toValue = @0;
    fade.duration = kRingSeconds;
    [ring addAnimation:fade forKey:nil];
  }
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kRingSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [ring removeFromSuperlayer];
  });
}

- (void)showState:(nullable NSString *)state title:(nullable NSString *)title fix:(nullable NSString *)fix {
  [_stateCard removeFromSuperview];
  _stateCard = nil;
  NSView *view = _view;
  if (!state || !view) return;
  NSMutableArray<NSView *> *parts = [NSMutableArray array];
  if ([state isEqual:@"connecting"] || [state isEqual:@"reconnecting"]) {
    NSProgressIndicator *spin = [NSProgressIndicator new];
    spin.style = NSProgressIndicatorStyleSpinning;
    spin.controlSize = NSControlSizeSmall;
    [spin startAnimation:nil];
    [parts addObject:spin];
  } else {
    [parts addObject:symbol(symbolOf(state), NSColor.whiteColor)];
  }
  [parts addObject:words(title ?: state, 14, NSFontWeightSemibold, NSColor.labelColor)];
  if (fix.length) [parts addObject:words(fix, 12, NSFontWeightRegular, NSColor.secondaryLabelColor)];
  _stateCard = card(parts);
  place(_stateCard, view, [_stateCard.centerYAnchor constraintEqualToAnchor:view.centerYAnchor]);
}

- (void)showBanner:(NSDictionary *)m {
  [self hideBanner];
  NSView *view = _view;
  if (!view) return;
  _bannerId = m[@"id"];
  NSMutableArray<NSView *> *parts = [NSMutableArray arrayWithArray:@[
    symbol(@"hand.raised", NSColor.systemYellowColor),
    words(m[@"title"] ?: @"Needs you", 14, NSFontWeightSemibold, NSColor.labelColor),
    words(m[@"text"] ?: @"A person is needed", 12, NSFontWeightRegular, NSColor.secondaryLabelColor),
  ]];
  if ([m[@"needsDone"] boolValue]) {
    NSButton *done = [NSButton buttonWithTitle:MVWord(@"I'm Done") target:self action:@selector(done:)];
    done.bezelColor = NSColor.controlAccentColor;
    done.keyEquivalent = @"\r";
    done.controlSize = NSControlSizeLarge;
    [parts addObject:done];
  }
  _banner = card(parts);
  place(_banner, view, [_banner.bottomAnchor constraintEqualToAnchor:view.bottomAnchor constant:-20]);
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
  if (_bannerId) MVEmitFrom(_view, @{@"op": @"done", @"id": _bannerId});
  [self hideBanner];
}

@end
