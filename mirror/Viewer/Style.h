// What the hub's panes are made of: its words, its colours, its symbols and how they move.
#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

@class MVStatusLine;

/// Words of the hub's panes.
typedef NS_ENUM(NSInteger, MVStyle) { MVStyleTitle, MVStyleBody, MVStyleStrong, MVStyleCallout, MVStyleHeading, MVStyleSub };
NSTextField *MVText(NSString *text, MVStyle style);
NSTextField *MVWrappedText(NSString *text, MVStyle style);
/// A colour as it is, by its look: the system's own fade to 2:1 in the bar of a window behind others, and this does not.
NSColor *MVSolid(NSColor *color);
/// What stands under a main word: it reads at 4.5:1 on any pane, in a window behind others too.
NSColor *MVQuietColor(void);
/// Green for live or passed, and orange for what needs a person: each holds 3:1 on every pane, dark and light.
NSColor *MVGreen(void);
NSColor *MVOrange(void);
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
void MVPulse(NSView *view);
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
