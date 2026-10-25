import Foundation

/// The host wire: `[u32 BE payload length][u8 type][payload]`; type 0 is one JSON-RPC message (UTF-8),
/// type 1 a binary attachment `[u32 BE request id][bytes]` sent right before its JSON response.
public enum Frame: Equatable {
    case json(Data)
    case binary(id: UInt32, data: Data)
}

public enum FrameError: Error, Equatable {
    case tooLarge(Int)
    case unknownType(UInt8)
    case noRequestId
}

public let maxFrameBytes = 64 * 1024 * 1024

public func encodeJSON(_ payload: Data) -> Data {
    var out = header(payload.count, 0)
    out.append(payload)
    return out
}

public func encodeBinary(id: UInt32, _ data: Data) -> Data {
    var out = header(data.count + 4, 1)
    out.append(contentsOf: u32(id))
    out.append(data)
    return out
}

private func u32(_ v: UInt32) -> [UInt8] { [UInt8(v >> 24 & 0xff), UInt8(v >> 16 & 0xff), UInt8(v >> 8 & 0xff), UInt8(v & 0xff)] }

private func header(_ length: Int, _ type: UInt8) -> Data {
    var d = Data(u32(UInt32(length)))
    d.append(type)
    return d
}

/// Collects stream bytes and returns the frames they complete.
public final class FrameDecoder {
    private var buffer = Data()

    public init() {}

    public func push(_ chunk: Data) throws -> [Frame] {
        buffer.append(chunk)
        var out: [Frame] = []
        while buffer.count >= 5 {
            let b = [UInt8](buffer.prefix(5))
            let length = Int(UInt32(b[0]) << 24 | UInt32(b[1]) << 16 | UInt32(b[2]) << 8 | UInt32(b[3]))
            let type = b[4]
            if length > maxFrameBytes { throw FrameError.tooLarge(length) }
            if type != 0 && type != 1 { throw FrameError.unknownType(type) }
            if buffer.count < 5 + length { break }
            let payload = buffer.subdata(in: buffer.startIndex + 5 ..< buffer.startIndex + 5 + length)
            buffer = buffer.subdata(in: buffer.startIndex + 5 + length ..< buffer.endIndex)
            if type == 0 {
                out.append(.json(payload))
            } else {
                if payload.count < 4 { throw FrameError.noRequestId }
                let p = [UInt8](payload.prefix(4))
                let id = UInt32(p[0]) << 24 | UInt32(p[1]) << 16 | UInt32(p[2]) << 8 | UInt32(p[3])
                out.append(.binary(id: id, data: payload.subdata(in: payload.startIndex + 4 ..< payload.endIndex)))
            }
        }
        return out
    }
}
