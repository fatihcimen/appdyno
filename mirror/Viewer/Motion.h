// What moved between gray frames of one size: on made-up frames in a self test, on a stream's in a `watch`.
#import <CoreVideo/CoreVideo.h>
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface MVMotion : NSObject
- (instancetype)initWithWidth:(int)width height:(int)height;
/// One frame, `width` bytes a row: compared with one a step of time before it, and kept in nothing but that.
- (void)addGray:(const uint8_t *)gray atMs:(double)ms;
/// `frames`, `ms`, `noisy`, and `regions`, each `kind` moves or changes, `x y w h` as fractions of the frame; one that
/// moves has `axis`, `sign`, `speed` as fractions of the frame along it each second, and `events`, each `kind` jump,
/// back or stop, `at` in ms from the first frame, `by` as a fraction along the axis.
- (NSDictionary *)summary;
@end

/// One `watch`: a stream's frames, gray and small, and at its end its one `watched` line, with a film strip if asked.
@interface MVWatch : NSObject
- (instancetype)initWithId:(NSString *)name ms:(double)ms strip:(BOOL)strip;
@property(readonly) double ms;
/// A frame has come: the time runs from then.
@property(readonly) BOOL started;
- (void)addImage:(CVImageBufferRef)image turns:(int)turns;
/// What the line says.
- (NSDictionary *)finish;
@end

NS_ASSUME_NONNULL_END
