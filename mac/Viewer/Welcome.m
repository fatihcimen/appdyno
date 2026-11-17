// The first time the hub opens, a moment of welcome: the site's dragon flies in, lands and breathes the word alight, and
// under it the three things a person does first, each a button that does it. Help → Welcome opens it again.
// The dragon is welcome.mov beside these sources, which scripts/render-dragon.py draws from the site's model; the fire
// and the word are drawn here, so the word is in the Mac's language. A person who asked for less motion gets the end.
#import "Defaults.h"
#import "HubParts.h"
#import "Words.h"
#import <AVFoundation/AVFoundation.h>

static NSString *const kWelcomed = @"welcomed";
static const double kWide = 560, kStageTall = 240, kTall = 520, kSide = 28;
/// Where the fire leaves the mouth on the stage, from its top left, as scripts/render-dragon.py says of the movie.
static const NSPoint kMouth = {187, 159};
/// Where the word stands: from just past the mouth to the stage's edge, its middle a little over the mouth.
static const double kWordLeft = 214, kWordMiddle = 140, kWordSize = 50;
/// When in the movie the fire burns, and when the movie ends: the clip's own times, from where it starts in the movie.
static const double kFireFrom = 2.05, kFireUntil = 2.38, kEnds = 3.6;

@interface MVWelcome : NSObject <NSWindowDelegate>
@property(nonatomic, readonly) MVOffscreenWindow *window;
@end

/// The window's ground, the hub's own, painted again as the look changes.
@interface MVWelcomeGround : NSView
@end

@implementation MVWelcomeGround
- (BOOL)wantsUpdateLayer {
  return YES;
}

- (void)updateLayer {
  MVGroundPlan plan;
  MVGroundOf(MVIsDark(self.effectiveAppearance), 2, &plan);
  CGImageRef ground = MVPaintGround(&plan);
  self.layer.contents = (__bridge id)ground;
  CGImageRelease(ground);
}

- (void)viewDidChangeEffectiveAppearance {
  [super viewDidChangeEffectiveAppearance];
  self.needsDisplay = YES;
}
@end

static MVWelcome *gWelcome;

/// The movie, where the parent named it and it is there.
static NSURL *_Nullable movieURL(void) {
  NSArray<NSString *> *args = NSProcessInfo.processInfo.arguments;
  NSUInteger at = [args indexOfObject:@"--welcome"];
  if (at == NSNotFound || args.count <= at + 1 || ![NSFileManager.defaultManager fileExistsAtPath:args[at + 1]]) return nil;
  return [NSURL fileURLWithPath:args[at + 1]];
}

/// A soft spark of light, for the fire's particles to add up.
static CGImageRef spark(void) {
  static CGImageRef image;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    const int side = 32;
    CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGContextRef context = CGBitmapContextCreate(NULL, side, side, 8, 0, space, (CGBitmapInfo)kCGImageAlphaPremultipliedLast);
    CGFloat stops[] = {1, 1, 1, 1, 1, 1, 1, 0};
    CGGradientRef glow = CGGradientCreateWithColorComponents(space, stops, NULL, 2);
    CGContextDrawRadialGradient(context, glow, CGPointMake(side / 2.0, side / 2.0), 0, CGPointMake(side / 2.0, side / 2.0), side / 2.0, 0);
    image = CGBitmapContextCreateImage(context);
    CGGradientRelease(glow);
    CGContextRelease(context);
    CGColorSpaceRelease(space);
  });
  return image;
}

@implementation MVWelcome {
  __weak MVHub *_hub;
  AVPlayer *_player;
  id _fire, _end;
  CALayer *_dragon, *_glow;
  CAGradientLayer *_sweep;
  CAEmitterLayer *_flame;
  NSView *_steps;
}

- (instancetype)initWithHub:(MVHub *)hub over:(NSWindow *)under behind:(BOOL)behind {
  if ((self = [super init])) {
    _hub = hub;
    NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskFullSizeContentView;
    _window = [[MVOffscreenWindow alloc] initWithContentRect:NSMakeRect(0, 0, kWide, kTall) styleMask:style backing:NSBackingStoreBuffered defer:NO];
    _window.title = MVWord(@"Welcome");
    _window.titlebarAppearsTransparent = YES;
    _window.titleVisibility = NSWindowTitleHidden;
    _window.releasedWhenClosed = NO;
    _window.movableByWindowBackground = YES;
    _window.delegate = self;
    NSView *ground = [MVWelcomeGround new];
    ground.wantsLayer = YES;
    _window.contentView = ground;
    NSURL *movie = movieURL();
    BOOL moves = movie && MVMoves();
    NSView *stage = [self stage:movie moving:moves];
    _steps = [self steps];
    // the steps come as the dragon has had its moment
    _steps.hidden = moves;
    for (NSView *part in @[stage, _steps]) {
      part.translatesAutoresizingMaskIntoConstraints = NO;
      [ground addSubview:part];
    }
    [NSLayoutConstraint activateConstraints:@[
      [stage.topAnchor constraintEqualToAnchor:ground.topAnchor],
      [stage.leadingAnchor constraintEqualToAnchor:ground.leadingAnchor],
      [stage.widthAnchor constraintEqualToConstant:kWide],
      [stage.heightAnchor constraintEqualToConstant:kStageTall],
      [_steps.topAnchor constraintEqualToAnchor:stage.bottomAnchor],
      [_steps.leadingAnchor constraintEqualToAnchor:ground.leadingAnchor
                                           constant:kSide],
      [_steps.trailingAnchor constraintEqualToAnchor:ground.trailingAnchor
                                            constant:-kSide],
    ]];
    // as tall as its words take, in either language: wrapped words know their height once they have their width
    for (int pass = 0; pass < 2; pass++) [ground layoutSubtreeIfNeeded];
    [_window setContentSize:NSMakeSize(kWide, kStageTall + NSHeight(_steps.frame) + kSide)];
    NSRect over = under.frame;
    [_window setFrameOrigin:NSMakePoint(NSMidX(over) - kWide / 2, NSMidY(over) - kTall / 2)];
    MVPresent(_window, behind ? MVShowBehind : under.isKeyWindow ? MVShowFocused
                                                                 : MVShowFront);
    if (moves) [self play];
  }
  return self;
}

/// The dragon, the word unlit over its ground, the word in the accent's colours that the fire uncovers, and the fire.
- (NSView *)stage:(nullable NSURL *)movie moving:(BOOL)moves {
  NSView *stage = [NSView new];
  stage.wantsLayer = YES;
  stage.accessibilityElement = YES;
  stage.accessibilityRole = NSAccessibilityStaticTextRole;
  stage.accessibilityLabel = MVWord(@"Welcome");
  CALayer *root = stage.layer;
  CGRect all = CGRectMake(0, 0, kWide, kStageTall);
  if (moves) {
    _player = [AVPlayer playerWithURL:movie];
    _player.muted = YES;
    AVPlayerLayer *shown = [AVPlayerLayer playerLayerWithPlayer:_player];
    shown.pixelBufferAttributes = @{(id)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_32BGRA)};
    _dragon = shown;
  } else {
    _dragon = [CALayer layer];
    if (movie) [self stillOf:movie];
  }
  _dragon.frame = all;
  [root addSublayer:_dragon];
  NSFont *font = [self wordFont];
  CALayer *dim = [self word:font color:MVQuietColor()];
  dim.opacity = 0.3;
  [root addSublayer:dim];
  _glow = [self word:font color:MVHeroMark()];
  _glow.shadowColor = [NSColor colorWithSRGBRed:1 green:0.55 blue:0.15 alpha:1].CGColor;
  _glow.shadowOpacity = 1;
  _glow.shadowRadius = 16;
  _glow.shadowOffset = CGSizeZero;
  _glow.opacity = 0;
  [root addSublayer:_glow];
  CAGradientLayer *lit = [CAGradientLayer layer];
  lit.frame = all;
  lit.startPoint = CGPointMake(0, 0.5);
  lit.endPoint = CGPointMake(1, 0.5);
  [stage.effectiveAppearance performAsCurrentDrawingAppearance:^{
    lit.colors = @[(id)MVFillFrom().CGColor, (id)MVFillTo().CGColor, (id)MVHeroMark().CGColor];
  }];
  lit.mask = [self word:font color:NSColor.blackColor];
  CALayer *uncovered = [CALayer layer];
  uncovered.frame = all;
  [uncovered addSublayer:lit];
  _sweep = [CAGradientLayer layer];
  _sweep.frame = all;
  _sweep.startPoint = CGPointMake(0, 0.5);
  _sweep.endPoint = CGPointMake(1, 0.5);
  _sweep.colors = @[(id)NSColor.blackColor.CGColor, (id)NSColor.blackColor.CGColor, (id)NSColor.clearColor.CGColor];
  _sweep.locations = moves ? @[@0, @0, @0] : @[@0, @1, @1];
  uncovered.mask = _sweep;
  [root addSublayer:uncovered];
  _flame = [self flame];
  [root addSublayer:_flame];
  return stage;
}

- (NSFont *)wordFont {
  NSFont *font = [NSFont systemFontOfSize:kWordSize weight:NSFontWeightHeavy];
  NSFontDescriptor *round = [font.fontDescriptor fontDescriptorWithDesign:NSFontDescriptorSystemDesignRounded];
  if (round) font = [NSFont fontWithDescriptor:round size:kWordSize];
  // a longer word in another language takes a smaller size, not the dragon's room
  double wide = [MVWord(@"Welcome") sizeWithAttributes:@{NSFontAttributeName: font}].width, room = kWide - kWordLeft - kSide;
  return wide > room ? [NSFont fontWithDescriptor:font.fontDescriptor size:kWordSize * room / wide] : font;
}

/// The word, as a layer the size of the stage, at its place there.
- (CATextLayer *)word:(NSFont *)font color:(NSColor *)color {
  CATextLayer *text = [CATextLayer layer];
  NSAttributedString *said = [[NSAttributedString alloc] initWithString:MVWord(@"Welcome") attributes:@{NSFontAttributeName: font, NSForegroundColorAttributeName: color}];
  NSSize size = said.size;
  text.string = said;
  text.contentsScale = NSScreen.mainScreen.backingScaleFactor ?: 2;
  text.frame = CGRectMake(kWordLeft, kStageTall - kWordMiddle - size.height / 2, size.width, size.height);
  return text;
}

/// A short breath of fire from the mouth toward the word, white hot as it leaves and orange as it cools, adding its light.
- (CAEmitterLayer *)flame {
  CAEmitterLayer *flame = [CAEmitterLayer layer];
  flame.frame = CGRectMake(0, 0, kWide, kStageTall);
  flame.emitterPosition = CGPointMake(kMouth.x, kStageTall - kMouth.y);
  flame.emitterShape = kCAEmitterLayerPoint;
  flame.renderMode = kCAEmitterLayerAdditive;
  flame.birthRate = 0;
  CAEmitterCell *fire = [CAEmitterCell emitterCell];
  fire.contents = (__bridge id)spark();
  fire.birthRate = 260;
  fire.lifetime = 0.42;
  fire.lifetimeRange = 0.12;
  fire.velocity = 210;
  fire.velocityRange = 50;
  // toward the word's first letters, a little up from the mouth
  fire.emissionLongitude = atan2(kMouth.y - kWordMiddle, kWordLeft + 30 - kMouth.x);
  fire.emissionRange = 0.32;
  fire.scale = 0.5;
  fire.scaleRange = 0.2;
  fire.scaleSpeed = 1.1;
  fire.alphaSpeed = -2.1;
  fire.color = [NSColor colorWithSRGBRed:1 green:0.96 blue:0.82 alpha:1].CGColor;
  fire.redSpeed = -0.2;
  fire.greenSpeed = -1.5;
  fire.blueSpeed = -2.2;
  CAEmitterCell *embers = [CAEmitterCell emitterCell];
  embers.contents = fire.contents;
  embers.birthRate = 40;
  embers.lifetime = 0.8;
  embers.velocity = 150;
  embers.velocityRange = 60;
  embers.emissionLongitude = fire.emissionLongitude;
  embers.emissionRange = 0.6;
  embers.yAcceleration = 90;
  embers.scale = 0.16;
  embers.alphaSpeed = -1.2;
  embers.color = MVHeroMark().CGColor;
  flame.emitterCells = @[fire, embers];
  return flame;
}

- (void)stillOf:(NSURL *)movie {
  AVAssetImageGenerator *frames = [AVAssetImageGenerator assetImageGeneratorWithAsset:[AVURLAsset assetWithURL:movie]];
  frames.requestedTimeToleranceBefore = frames.requestedTimeToleranceAfter = kCMTimeZero;
  __weak CALayer *dragon = _dragon;
  [frames generateCGImageAsynchronouslyForTime:CMTimeMakeWithSeconds(kEnds - 0.05, 600)
                             completionHandler:^(CGImageRef image, __unused CMTime at, __unused NSError *error) {
                               if (!image) return;
                               CGImageRetain(image);
                               dispatch_async(dispatch_get_main_queue(), ^{
                                 dragon.contents = (__bridge id)image;
                                 CGImageRelease(image);
                               });
                             }];
}

/// The movie runs once; the fire and the word go by its clock, so neither runs ahead of the dragon on a slow start.
- (void)play {
  __weak MVWelcome *weak = self;
  _fire = [_player addBoundaryTimeObserverForTimes:@[[NSValue valueWithCMTime:CMTimeMakeWithSeconds(kFireFrom, 600)]]
                                             queue:dispatch_get_main_queue()
                                        usingBlock:^{
                                          [weak breathe];
                                        }];
  _end = [_player addBoundaryTimeObserverForTimes:@[[NSValue valueWithCMTime:CMTimeMakeWithSeconds(kEnds - 0.7, 600)]]
                                            queue:dispatch_get_main_queue()
                                       usingBlock:^{
                                         [weak showSteps];
                                       }];
  [_player play];
}

- (void)breathe {
  _flame.beginTime = CACurrentMediaTime();
  _flame.birthRate = 1;
  __weak CAEmitterLayer *flame = _flame;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)((kFireUntil - kFireFrom) * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    flame.birthRate = 0;
  });
  // the word lights from its first letter on, as the fire reaches it
  CABasicAnimation *sweep = [CABasicAnimation animationWithKeyPath:@"locations"];
  sweep.fromValue = @[@0, @0, @0];
  sweep.toValue = @[@0, @1, @1];
  sweep.beginTime = CACurrentMediaTime() + 0.08;
  sweep.duration = 0.55;
  sweep.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseOut];
  sweep.fillMode = kCAFillModeBackwards;
  _sweep.locations = sweep.toValue;
  [_sweep addAnimation:sweep forKey:@"sweep"];
  CAKeyframeAnimation *glow = [CAKeyframeAnimation animationWithKeyPath:@"opacity"];
  glow.values = @[@0, @0.9, @0];
  glow.keyTimes = @[@0, @0.3, @1];
  glow.duration = 1.2;
  [_glow addAnimation:glow forKey:@"glow"];
}

- (void)showSteps {
  _steps.hidden = NO;
  MVSlideIn(_steps, 24);
}

- (NSView *)steps {
  NSArray<NSArray<NSString *> *> *all = @[
    @[@"sparkles", @"Connect your AI client", @"So it can see and drive your devices.", @"AI Clients", @"welcomeClients"],
    @[@"iphone", @"Start a simulator", @"Or an Android emulator: it shows here, live.", @"New Simulator…", @"welcomeDevice"],
    @[@"cable.connector", @"Connect a phone", @"An iPhone or Android phone, by cable or Wi-Fi.", @"Connect a Phone", @"welcomePhone"],
  ];
  NSMutableArray<NSView *> *rows = [NSMutableArray array];
  [all enumerateObjectsUsingBlock:^(NSArray<NSString *> *step, NSUInteger at, __unused BOOL *stop) {
    NSStackView *words = MVPlaceColumn(@[MVText(step[1], MVStyleStrong), MVParagraph(step[2], MVStyleSub)], 2);
    [words setHuggingPriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
    NSStackView *lead = [NSStackView stackViewWithViews:@[MVTile(step[0], MVHueTile((NSInteger)at), 32), words]];
    lead.distribution = NSStackViewDistributionFill;
    lead.spacing = 12;
    NSButton *button = at == 0 ? MVPlacePrimary(step[3], step[4], self, @selector(chose:)) : MVPlaceButton(step[3], step[4], self, @selector(chose:));
    if (rows.count) [rows addObject:MVSeparator()];
    [rows addObject:MVPlaceRow(lead, @[button])];
  }];
  NSView *card = MVCard(MVPlaceColumn(rows, 12), 14);
  return MVPlaceColumn(@[MVText(@"Three things to do first", MVStyleHeading), card], 10);
}

- (void)chose:(NSButton *)sender {
  NSString *step = @{@"welcomeClients": @"AI Clients", @"welcomeDevice": @"device", @"welcomePhone": @"Connect a Phone"}[sender.identifier];
  MVHub *hub = _hub;
  [_window close];
  if (step) [hub welcomeChose:step];
}

- (void)windowWillClose:(NSNotification *)notification {
  [_player pause];
  for (id observer in @[_fire ?: NSNull.null, _end ?: NSNull.null])
    if (observer != NSNull.null) [_player removeTimeObserver:observer];
  _fire = _end = nil;
  if (gWelcome == self) dispatch_async(dispatch_get_main_queue(), ^{
    gWelcome = nil;
  });
}
@end

/// HubPlaces.m's way to a place by its title.
@interface MVHub (Going)
- (void)goTo:(NSString *)title;
@end

@implementation MVHub (Welcome)

- (void)welcomeOnce {
  if ([MVDefaults() boolForKey:kWelcomed]) return;
  [MVDefaults() setBool:YES forKey:kWelcomed];
  [self openWelcome:nil];
}

- (void)openWelcome:(id)sender {
  if (gWelcome) return MVPresent(gWelcome.window, _window.offscreen ? MVShowBehind : MVShowFocused);
  gWelcome = [[MVWelcome alloc] initWithHub:self over:_window behind:_window.offscreen];
}

- (nullable NSWindow *)welcomeWindow {
  return gWelcome.window;
}

/// A device to start is the New Simulator sheet, the hub's own, which says what this Mac can make.
- (void)welcomeChose:(NSString *)step {
  // a person clicked: the hub takes the keyboard the one way a window here does
  if (!_window.offscreen) MVPresent(_window, MVShowFocused);
  if ([step isEqual:@"device"]) [self ask:@"simulator"];
  else [self goTo:step];
}

@end
