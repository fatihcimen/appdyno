/// Whether a connection's two ends are those of a tunnel a Mac opened to this phone. A VPN's interface is of the same
/// kind as a tunnel's, so the kind alone lets one in: every tunnel seen gave the phone `::1` and the Mac `::2` of one
/// private /64, which a VPN's addresses are not unless it was set up to look so. Each address as its 16 bytes; else no
/// tunnel.
public func tunnelEnds(local: [UInt8], remote: [UInt8]) -> Bool {
    guard local.count == 16, remote.count == 16, local[0] == 0xfd, local[..<8] == remote[..<8] else { return false }
    let host = { (last: UInt8) in [UInt8](repeating: 0, count: 7) + [last] }
    return Array(local[8...]) == host(1) && Array(remote[8...]) == host(2)
}
