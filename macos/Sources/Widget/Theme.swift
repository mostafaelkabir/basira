import SwiftUI

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

enum Basira {
    static let canvas = Color(hex: 0x10251D)   // deep ink
    static let raised = Color(hex: 0x163227)
    static let accent = Color(hex: 0xBCE0B3)   // luminous emerald
    static let ink    = Color(hex: 0xEAF4E8)
    static let muted  = Color(hex: 0x8FB39C)
}
