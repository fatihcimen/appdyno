// What the hub's panes are made of: its words, its colours, its symbols and how they move.
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>

NS_ASSUME_NONNULL_BEGIN

@class MVStatusLine;

/// Words of the hub's panes.
typedef NS_ENUM(NSInteger, MVStyle) { MVStyleHero, MVStyleTitle, MVStyleBody, MVStyleStrong, MVStyleCallout, MVStyleHeading, MVStyleSub };
NSTextField *MVText(NSString *text, MVStyle style);
NSTextField *MVWrappedText(NSString *text, MVStyle style);
/// A colour as it is, by its look: the system's own fade to 2:1 in the bar of a window behind others, and this does not.
NSColor *MVSolid(NSColor *color);
/// Main words.
NSColor *MVInkColor(void);
/// What stands under a main word: it reads at 4.5:1 on any pane, in a window behind others too.
NSColor *MVQuietColor(void);
/// Live or passed, what needs a person, and what failed or got worse: never decoration, and always with a symbol and a word.
NSColor *MVGreen(void);
NSColor *MVOrange(void);
NSColor *MVRed(void);
/// An agent at work.
NSColor *MVAgent(void);
/// What is chosen, and the one thing a person came to press.
NSColor *MVAccent(void);
NSColor *MVFillFrom(void);
NSColor *MVFillTo(void);
/// What stands out on the accent's own gradient, in either look.
NSColor *MVHeroMark(void);
/// A solid ground of the palette's, for what lies over a device.
NSColor *MVSurface(void);
/// What a person asked of the whole Mac. Increase Contrast: stronger lines and marks. Reduce Transparency: plain grounds, solid
/// cards. Differentiate Without Color: what a colour alone would say gets a shape too.
BOOL MVStrongContrast(void);
BOOL MVSolidGrounds(void);
BOOL MVWithoutColor(void);
/// A hue of the palette: a place, a part of a page or a measure wears one. Never a state.
NSColor *MVHue(NSInteger at);
NSColor *MVHueTile(NSInteger at);
/// A card's ground, the light on its rim and its shadow: a fill, as glass is for controls.
NSColor *MVCardFill(void);
NSColor *MVCardEdge(void);
/// A line, at a strength.
NSColor *MVRule(double alpha);
BOOL MVIsDark(NSAppearance *look);

enum { MVGroundBlooms = 6 };
/// A glow on a ground: where, how far and how strongly, from the window's top left.
typedef struct {
  float x, y, reach, strength;
  uint32_t color;
} MVGroundBloom;
typedef struct {
  uint32_t ground;
  int count;
  MVGroundBloom blooms[MVGroundBlooms];
} MVGroundPlan;
/// The palette's ground for a look, its colours turned for a place.
void MVGroundOf(BOOL dark, NSInteger place, MVGroundPlan *plan);
/// A few pixels of it, for a layer to stretch. Caller owns it.
CGImageRef MVPaintGround(const MVGroundPlan *plan);
/// A still fine grain, as a layer's colour.
CGColorRef MVGrain(void);
/// A symbol in its own ink: AppKit dims a template in a window behind others, and leaves this as it is.
NSImage *_Nullable MVSymbol(NSString *name, NSColor *color, CGFloat size, NSFontWeight weight);
/// A symbol drawn by itself: in a window behind others AppKit fades every image in the bar, whatever its ink, and not this.
@interface MVInk : NSView
- (instancetype)initWithSymbol:(NSString *)symbol color:(NSColor *)color size:(CGFloat)size;
- (void)paint:(NSString *)symbol color:(NSColor *)color;
@property(nonatomic) CGFloat size;
@end

/// Words for a screen reader, in the Mac's language.
void MVAnnounce(NSString *words);
/// One small spring for something found: nothing for a person who asked for less motion.
/// Once, from this scale to its own, about its centre.
void MVPulse(NSView *view, double scale);
/// A spring that comes to rest, and where the system has none, below macOS 14, the same move eased.
CABasicAnimation *MVSpring(NSString *keyPath, double seconds, double bounce);
/// Whether a person has left motion on.
BOOL MVMoves(void);
/// As if a person had asked for less motion: a test's way to it, as that setting is the whole Mac's.
void MVHoldStill(BOOL held);
/// Opacity to `to`; at once for a person who asked for less motion.
void MVFade(CALayer *layer, double from, double to, double seconds);

/// A click on a window not in use is the click a person meant: without this its first click on any control only made the
/// window the one in use, with nothing to show for it, and this window is usually not the one in use.
@interface MVBarButton : NSButton
@end

/// What a device is at, in the toolbar. A click on it shows the stream's numbers.
@interface MVCapsule : MVBarButton
- (void)show:(MVStatusLine *)line;
/// What it says now.
@property(nonatomic, readonly) NSString *words;
@end

NS_ASSUME_NONNULL_END
