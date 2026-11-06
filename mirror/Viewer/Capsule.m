// The one place a device's state is read: a capsule in the toolbar, with a symbol and words for whatever is happening and
// a bar along its foot while a measure runs. The line decides what is said, and the capsule shows it.
#import "Viewer.h"
#import "Window.h"
#import "Words.h"

static const double kHigh = 28, kMark = 12, kDotMark = 8, kBar = 2, kStepSeconds = 0.15, kWordsSeconds = 0.15, kNoteSeconds = 4, kWidest = 220, kInset = 12;

@implementation MVStatusLine {
  NSString *_note;
}

- (void)say:(NSString *)note {
  _note = note;
  if (self.onChange) self.onChange();
  __weak MVStatusLine *weak = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kNoteSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [weak clear:note];
  });
}

- (void)clear:(NSString *)note {
  if (_note != note) return;
  _note = nil;
  if (self.onChange) self.onChange();
}

- (NSString *)liveWords {
  NSMutableArray<NSString *> *parts = [NSMutableArray arrayWithObject:self.state ?: @"Connecting"];
  if (self.rate > 0) [parts addObject:[NSString stringWithFormat:@"%.0f fps", self.rate]];
  if (self.link.length) [parts addObject:self.link];
  return [parts componentsJoinedByString:@" · "];
}

- (NSString *)mainWords {
  if (self.failing) return self.failing;
  if (!self.live) return self.state ?: @"Connecting";
  if (self.measuring) return self.measuring;
  if (self.recording) return @"Recording";
  if (self.tool) return self.client.length ? [NSString stringWithFormat:@"%@ driving", self.client] : @"AI client driving";
  return self.liveWords;
}

- (NSString *)stringValue {
  if (_note) return _note;
  NSString *main = self.mainWords;
  return self.pairing && !self.failing ? [NSString stringWithFormat:@"%@ · %@", main, self.pairing] : main;
}

- (MVTone)tone {
  if (self.failing || self.recording) return MVToneBad;
  if (self.stuck) return MVToneNeedsYou;
  if (!self.live || self.measuring) return MVToneBusy;
  return self.tool ? MVToneAgent : MVToneLive;
}

@end

/// A state is never a colour alone: each has its symbol, and the capsule has its words.
static NSString *symbolOf(MVTone tone) {
  switch (tone) {
    case MVToneLive:
      return @"circle.fill";
    case MVToneBusy:
      return @"arrow.triangle.2.circlepath";
    case MVToneNeedsYou:
      return @"exclamationmark.triangle.fill";
    case MVToneAgent:
      return @"sparkles";
    case MVToneBad:
      return @"record.circle";
  }
}

static NSColor *colorOf(MVTone tone) {
  switch (tone) {
    case MVToneLive:
      return MVGreen();
    case MVToneBusy:
      return MVInkColor();
    case MVToneNeedsYou:
      return MVOrange();
    case MVToneAgent:
      return MVAgent();
    case MVToneBad:
      return MVRed();
  }
}

@implementation MVCapsule {
  MVInk *_mark;
  NSTextField *_words;
  NSStackView *_row;
  CALayer *_bar;
  MVTone _tone;
  BOOL _shown;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    self.bordered = NO;
    self.title = @"";
    self.identifier = @"status";
    self.wantsLayer = YES;
    _mark = [[MVInk alloc] initWithSymbol:symbolOf(MVToneBusy) color:colorOf(MVToneBusy) size:kMark];
    _words = MVText(@"", MVStyleCallout);
    _words.wantsLayer = YES;
    _row = [NSStackView stackViewWithViews:@[_mark, _words]];
    _row.spacing = 6;
    _row.translatesAutoresizingMaskIntoConstraints = NO;
    [self addSubview:_row];
    [NSLayoutConstraint activateConstraints:@[
      [self.heightAnchor constraintEqualToConstant:kHigh],
      [_mark.widthAnchor constraintEqualToConstant:kMark + 2],
      [_row.centerXAnchor constraintEqualToAnchor:self.centerXAnchor],
      [_row.centerYAnchor constraintEqualToAnchor:self.centerYAnchor],
    ]];
    _bar = [CALayer layer];
    _bar.backgroundColor = MVAccent().CGColor;
    _bar.anchorPoint = CGPointZero;
    [self.layer addSublayer:_bar];
  }
  return self;
}

/// As wide as what it says, and no wider than a bar can spare.
- (NSSize)intrinsicContentSize {
  return NSMakeSize(MIN(_row.fittingSize.width + 2 * kInset, kWidest), kHigh);
}

- (void)setProgress:(double)part {
  [CATransaction begin];
  // a linear step for each sample, or at once for a person who asked for less motion
  [CATransaction setAnimationDuration:kStepSeconds];
  [CATransaction setAnimationTimingFunction:[CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionLinear]];
  [CATransaction setDisableActions:!MVMoves()];
  _bar.hidden = part <= 0;
  _bar.frame = CGRectMake(0, 0, self.bounds.size.width * MIN(part, 1), kBar);
  [CATransaction commit];
}

- (void)show:(MVStatusLine *)line {
  NSString *words = line.stringValue;
  MVTone tone = line.tone;
  if (!_shown || tone != _tone) {
    _mark.size = tone == MVToneLive ? kDotMark : kMark;
    [_mark paint:symbolOf(tone) color:colorOf(tone)];
  }
  if ([words isEqual:_words.stringValue]) return [self setProgress:line.progress];
  if (MVMoves() && _shown) {
    CATransition *fade = [CATransition animation];
    fade.type = kCATransitionFade;
    fade.duration = kWordsSeconds;
    [_words.layer addAnimation:fade forKey:@"words"];
  }
  _words.stringValue = words;
  [self invalidateIntrinsicContentSize];
  _tone = tone;
  _shown = YES;
  self.toolTip = words;
  self.accessibilityLabel = words;
  [self setProgress:line.progress];
}

- (NSString *)words {
  return _words.stringValue;
}

@end
