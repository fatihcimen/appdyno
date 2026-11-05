// The viewer: one window, one process, per device. JSON lines on stdin and stdout; it ends with its stdin.
// A source feeds a sink, and adding a kind of device means adding a source to MVSourceClasses.
#import <AVFoundation/AVFoundation.h>
#import <AppKit/AppKit.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <IOSurface/IOSurface.h>
#import <QuartzCore/QuartzCore.h>
#import <VideoToolbox/VideoToolbox.h>

NS_ASSUME_NONNULL_BEGIN

double MVNowMs(void);
/// One JSON line on stdout, from any thread.
void MVEmit(NSDictionary *message);

/// What a second of frames came to. Thread safe; sources and the sink feed it, the app reports it.
@interface MVStats : NSObject
@property(atomic, copy) NSString *source;
@property(atomic, copy) NSString *mode;
@property(atomic, copy) NSString *decoder;
/// What became of the last picture a window's layer was given: empty with no layer.
@property(atomic, copy) NSString *layer;
/// What a source counts of its own, since it began, reported as it is.
@property(atomic, copy, nullable) NSDictionary *counters;
@property(atomic) CGSize size;
- (void)arrived:(size_t)bytes captureMs:(double)ms;
- (void)decodedMs:(double)ms;
- (void)shown;
- (void)dropped:(int)count;
/// The next frame to arrive answers `marked` with the time since this call; with `bigger`, the next that is well
/// over the size of those before it, for a source that keeps sending on a still screen.
- (void)mark:(BOOL)bigger;
- (void)reset;
/// This second's numbers, and starts the next.
- (NSDictionary *)report;
@end

/// Where a source gives what it has. Any thread; `from` lets a detached source's late calls be ignored.
@protocol MVSink <NSObject>
@property(readonly) MVStats *stats;
- (void)source:(id)from size:(CGSize)size codec:(NSString *)codec;
- (void)source:(id)from surface:(IOSurfaceRef)surface;
- (void)source:(id)from image:(CVImageBufferRef)image;
- (void)source:(id)from lost:(NSString *)why fatal:(BOOL)fatal;
/// A picture to show stood up by these quarter turns, counterclockwise, with no copy of it.
- (void)source:(id)from turns:(int)turns;
/// A keyframe is wanted; `failures` counts decoder failures in a row, none for a loss.
- (void)source:(id)from needsKey:(int)failures;
@end

@protocol MVSource <NSObject>
- (instancetype)initWithOptions:(NSDictionary *)options sink:(id<MVSink>)sink;
- (void)start;
/// No call reaches the sink after this returns.
- (void)stop;
@optional
- (void)tick:(NSDictionary *)message;
/// The device's content is drawn this many quarter turns from upright, and nothing in the source says so.
- (void)setTurns:(int)turns;
/// The window is covered: nothing need be drawn, and what comes back asks for a fresh picture.
- (void)setHidden:(BOOL)hidden;
@end

/// A stream's frames into a movie, with no second encode.
@interface MVRecorder : NSObject
- (instancetype)initWithFile:(NSString *)file;
/// YES until its first frame: a key frame is what it can start from.
- (BOOL)wantsKey;
- (void)append:(CMSampleBufferRef)sample format:(CMFormatDescriptionRef)format key:(BOOL)key;
/// Ends the file with what it holds: `frames`, `seconds`, `dropped`, and `why` if it ended early.
- (NSDictionary *)finish;
@end

/// The sources by the `kind` of an `attach`.
NSDictionary<NSString *, Class> *MVSourceClasses(void);

/// Calls `found` with each NAL unit of an Annex B buffer. Input is hostile: nothing is read out of bounds.
void MVForEachNal(const uint8_t *data, size_t length, void (^found)(const uint8_t *nal, size_t length));

/// Compressed frames in, decoded images to the sink. A loss or a failure freezes the picture until a keyframe.
@interface MVDecoder : NSObject
@property(atomic, nullable) MVRecorder *recorder;
- (instancetype)initWithSink:(id<MVSink>)sink from:(id)source;
@property(atomic) BOOL hevc;
/// What to show of each picture, from its top left, where the coded one is larger; zero: all of it.
@property(atomic) CGSize crop;
/// One access unit; returns NO when it was dropped or failed.
- (BOOL)decode:(const uint8_t *)data length:(size_t)length;
/// Nothing is decoded until a keyframe comes, and one is asked for.
- (void)awaitKey;
- (void)close;
@end

/// Reads the agent's connection: frames and clock, and hands frames to a decoder.
@interface MVSourceStream : NSObject <MVSource>
/// Runs on an open connection, with no adb in front of it.
- (void)runOnDescriptor:(int)fd;
- (void)startRecording:(NSString *)file;
/// What the movie came to; nil if none was being made.
- (nullable NSDictionary *)finishRecording;
@end

@interface MVSourceSurface : NSObject <MVSource>
@end

@interface MVSourcePixels : NSObject <MVSource>
@end

/// A point in a view, as a fraction of the picture inside it; NO outside the picture.
BOOL MVNormalize(NSPoint point, NSSize bounds, CGSize picture, double *x, double *y);
/// The half distance between two fingers after a trackpad's magnification, within what a screen can hold.
double MVPinchGap(double gap, double magnification, double most);
/// The USB usage (page 7) of a Mac key that types no character; 0 when it has none.
uint16_t MVUsageOfKeyCode(uint16_t keyCode);
/// Whether a key event's text is to be typed as text, rather than sent as a key.
BOOL MVIsTypedText(NSString *characters, NSEventModifierFlags flags);

/// What sits over the picture, for a person's eyes.
@interface MVOverlay : NSObject
- (instancetype)initInView:(NSView *)view;
/// How the stream is, when it is not live; no `state` takes it away.
- (void)showState:(nullable NSString *)state title:(nullable NSString *)title fix:(nullable NSString *)fix;
- (void)showBanner:(NSDictionary *)message;
- (void)hideBanner;
/// The banner's button.
- (void)done:(id)sender;
@end

/// Lays a layer out in its parent's size, stood up from its contents by these quarter turns, counterclockwise.
void MVLayoutTurned(CALayer *layer, CGSize parent, int turns);

/// The window. The app keeps none when it runs headless.
@interface MVWindow : NSObject <NSWindowDelegate>
@property(readonly) MVOverlay *overlay;
- (void)configure:(NSDictionary *)attach;
- (void)setPicture:(CGSize)size;
- (void)setTurns:(int)turns;
- (void)showSurface:(IOSurfaceRef)surface;
/// Whether the layer took it.
- (BOOL)showImage:(CVImageBufferRef)image;
- (void)setStatus:(NSDictionary *)message;
- (void)setDriving:(BOOL)driving tool:(NSString *)tool;
/// Words beneath the device for a few seconds: what became of something a person asked for.
- (void)sayNote:(NSString *)note;
- (void)setRecording:(BOOL)on;
- (void)showPane:(NSInteger)pane;
- (void)showStats:(NSDictionary *)stats;
- (void)showPerf:(NSDictionary *)message;
- (void)showMeasure:(NSDictionary *)message;
- (void)addActivity:(NSDictionary *)call;
- (void)showApps:(NSDictionary *)message;
/// What a control of the window does, by its name.
- (void)perform:(NSString *)name;
/// Comes forward, with no keyboard: asked for by a second start, or an agent.
- (void)raise;
@property(nonatomic) BOOL behind;
/// Drawn as the window in use, for a picture of it.
@property(nonatomic) BOOL poses;
/// A click at this fraction of the picture, by the window's own event queue: needs no permission to post.
- (void)pokeX:(double)x y:(double)y right:(BOOL)right;
- (void)pokeText:(NSString *)text;
- (void)pokeX:(double)x y:(double)y toX:(double)x2 toY:(double)y2 seconds:(double)seconds;
- (void)pokeKey:(NSString *)characters;
- (void)pokeButton:(NSString *)name;
/// The window as it looks now, to a PNG.
- (BOOL)snapshot:(NSString *)file;
/// The device's screen alone, as this window shows it.
- (BOOL)snapshotScreen:(NSString *)file;
@property(nonatomic, copy, nullable) void (^onHidden)(BOOL hidden);
@end

/// Runs the checks; the process's exit code.
int MVSelfTest(NSString *_Nullable fixtures);
/// Writes encoded test frames to stdout, for a stand-in agent: `[u32 length][u8 key][bytes]`.
int MVEncodeFixture(NSString *codec, int frames);

NS_ASSUME_NONNULL_END
