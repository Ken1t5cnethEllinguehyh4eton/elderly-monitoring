// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ElderlyMonitoringFHE is SepoliaConfig {
    // Note: keep code modular for upgrades
    struct EncryptedSensorData {
        uint256 id;
        euint32 encryptedActivityVector; // Encrypted sensor vector
        euint32 encryptedSleepVector;    // Encrypted sleep data
        uint256 timestamp;
    }

    struct EncryptedAlert {
        uint256 id;
        euint32 encryptedAlertPayload; // Encrypted alert payload
        uint256 timestamp;
    }

    struct DecryptedEvent {
        string summary;
        bool isHandled;
    }

    uint256 public sensorDataCount;
    uint256 public alertCount;

    mapping(uint256 => EncryptedSensorData) public sensorDatas;
    mapping(uint256 => EncryptedAlert) public encryptedAlerts;
    mapping(uint256 => DecryptedEvent) public decryptedEvents;

    mapping(uint256 => uint256) private requestToDataId;
    mapping(uint256 => uint256) private requestToAlertId;

    event SensorDataSubmitted(uint256 indexed id, uint256 timestamp);
    event AnomalyDetectionRequested(uint256 indexed id);
    event AnomalyDetected(uint256 indexed id);
    event EncryptedAlertSubmitted(uint256 indexed id, uint256 timestamp);
    event AlertDecryptionRequested(uint256 indexed id);
    event AlertDecrypted(uint256 indexed id);

    modifier onlySource() {
        // Placeholder for access control
        _;
    }

    /// @notice Submit encrypted sensor vectors collected from a device
    function submitEncryptedSensorData(
        euint32 encryptedActivityVector,
        euint32 encryptedSleepVector
    ) public {
        sensorDataCount += 1;
        uint256 newId = sensorDataCount;

        sensorDatas[newId] = EncryptedSensorData({
            id: newId,
            encryptedActivityVector: encryptedActivityVector,
            encryptedSleepVector: encryptedSleepVector,
            timestamp: block.timestamp
        });

        decryptedEvents[newId] = DecryptedEvent({ summary: "", isHandled: false });

        emit SensorDataSubmitted(newId, block.timestamp);
    }

    /// @notice Request anomaly detection on stored encrypted data
    function requestAnomalyDetection(uint256 dataId) public onlySource {
        EncryptedSensorData storage dataRecord = sensorDatas[dataId];
        require(dataRecord.id != 0, "Data not found");

        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(dataRecord.encryptedActivityVector);
        ciphertexts[1] = FHE.toBytes32(dataRecord.encryptedSleepVector);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.handleAnomalyResult.selector);
        requestToDataId[reqId] = dataId;

        emit AnomalyDetectionRequested(dataId);
    }

    /// @notice Callback invoked when decrypted anomaly result is available
    function handleAnomalyResult(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 dataId = requestToDataId[requestId];
        require(dataId != 0, "Invalid request");

        DecryptedEvent storage ev = decryptedEvents[dataId];
        require(!ev.isHandled, "Already handled");

        FHE.checkSignatures(requestId, cleartexts, proof);

        string[] memory results = abi.decode(cleartexts, (string[]));
        // results[0] could be a short summary like "no_anomaly" or "fall_detected"
        ev.summary = results.length > 0 ? results[0] : "";
        ev.isHandled = true;

        emit AnomalyDetected(dataId);
    }

    /// @notice Submit an encrypted alert payload (e.g., produced by an edge model)
    function submitEncryptedAlert(euint32 encryptedPayload) public {
        alertCount += 1;
        uint256 newId = alertCount;

        encryptedAlerts[newId] = EncryptedAlert({
            id: newId,
            encryptedAlertPayload: encryptedPayload,
            timestamp: block.timestamp
        });

        emit EncryptedAlertSubmitted(newId, block.timestamp);
    }

    /// @notice Request decryption of an encrypted alert
    function requestAlertDecryption(uint256 alertId) public onlySource {
        EncryptedAlert storage a = encryptedAlerts[alertId];
        require(a.id != 0, "Alert not found");

        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(a.encryptedAlertPayload);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.handleAlertCleartext.selector);
        requestToAlertId[reqId] = alertId;

        emit AlertDecryptionRequested(alertId);
    }

    /// @notice Callback for decrypted alert payloads
    function handleAlertCleartext(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 alertId = requestToAlertId[requestId];
        require(alertId != 0, "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        string memory alertText = abi.decode(cleartexts, (string));
        // process alertText off-chain or emit event
        emit AlertDecrypted(alertId);
    }

    /// @notice Retrieve decrypted event summary
    function getDecryptedEvent(uint256 dataId) public view returns (string memory summary, bool handled) {
        DecryptedEvent storage ev = decryptedEvents[dataId];
        return (ev.summary, ev.isHandled);
    }
}
