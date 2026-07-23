import Foundation

let sentinel = "U0S-\(UUID().uuidString)"
FileHandle.standardOutput.write(Data(sentinel.utf8))
try? FileHandle.standardOutput.close()
