import AVFoundation
import SwiftUI
import MermaidCollabCore

struct QRScannerView: UIViewControllerRepresentable {
    var onScan: (PairingLink) -> Void

    func makeUIViewController(context: Context) -> ScannerViewController {
        let controller = ScannerViewController()
        controller.onScan = onScan
        controller.onDenied = { context.coordinator.showDenied = true }
        return controller
    }

    func updateUIViewController(_ uiViewController: ScannerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    final class Coordinator: NSObject {
        @Published var showDenied = false
    }
}

final class ScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let session = AVCaptureSession()
    var onScan: ((PairingLink) -> Void)?
    var onDenied: (() -> Void)?
    private var hasDecodedOnce = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
            DispatchQueue.main.async {
                if granted {
                    self?.configureSession()
                } else {
                    self?.onDenied?()
                }
            }
        }
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        if !hasDecodedOnce {
            DispatchQueue.global(qos: .background).async {
                self.session.startRunning()
            }
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        session.stopRunning()
    }

    private func configureSession() {
        guard let videoCaptureDevice = AVCaptureDevice.default(for: .video) else {
            print("No video device available")
            return
        }

        do {
            let videoInput = try AVCaptureDeviceInput(device: videoCaptureDevice)
            if session.canAddInput(videoInput) {
                session.addInput(videoInput)
            }

            let metadataOutput = AVCaptureMetadataOutput()
            if session.canAddOutput(metadataOutput) {
                session.addOutput(metadataOutput)
                metadataOutput.setMetadataObjectsDelegate(self, queue: .main)
                metadataOutput.metadataObjectTypes = [.qr]
            }

            let previewLayer = AVCaptureVideoPreviewLayer(session: session)
            previewLayer.frame = view.bounds
            previewLayer.videoGravity = .resizeAspectFill
            view.layer.addSublayer(previewLayer)
        } catch {
            print("Failed to configure camera: \(error)")
        }
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        for metadata in metadataObjects {
            guard let machineReadableCode = metadata as? AVMetadataMachineReadableCodeObject,
                  machineReadableCode.type == .qr,
                  let stringValue = machineReadableCode.stringValue,
                  let link = PairingLink.parse(stringValue) else {
                continue
            }

            hasDecodedOnce = true
            session.stopRunning()
            DispatchQueue.main.async {
                self.onScan?(link)
            }
            break
        }
    }
}
