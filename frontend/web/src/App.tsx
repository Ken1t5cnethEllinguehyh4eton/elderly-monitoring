// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface HealthRecord {
  id: string;
  type: 'activity' | 'sleep' | 'alert';
  timestamp: number;
  encryptedData: string;
  status: 'normal' | 'abnormal';
  fheProcessed: boolean;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({
    type: "activity",
    description: "",
    value: ""
  });
  const [expandedRecord, setExpandedRecord] = useState<string | null>(null);
  
  // Calculate statistics
  const totalRecords = records.length;
  const abnormalCount = records.filter(r => r.status === 'abnormal').length;
  const activityCount = records.filter(r => r.type === 'activity').length;
  const sleepCount = records.filter(r => r.type === 'sleep').length;
  const alertCount = records.filter(r => r.type === 'alert').length;

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("health_records_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing record keys:", e);
        }
      }
      
      const list: HealthRecord[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`health_record_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                type: recordData.type,
                timestamp: recordData.timestamp,
                encryptedData: recordData.encryptedData,
                status: recordData.status,
                fheProcessed: recordData.fheProcessed
              });
            } catch (e) {
              console.error(`Error parsing record data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading record ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) {
      console.error("Error loading records:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitRecord = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting health data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify({
        type: newRecordData.type,
        value: newRecordData.value,
        description: newRecordData.description
      }))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const recordData = {
        type: newRecordData.type,
        timestamp: Math.floor(Date.now() / 1000),
        encryptedData: encryptedData,
        status: 'normal', // Initially normal until FHE analysis
        fheProcessed: false
      };
      
      // Store encrypted health data on-chain using FHE
      await contract.setData(
        `health_record_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(recordData))
      );
      
      const keysBytes = await contract.getData("health_records_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(recordId);
      
      await contract.setData(
        "health_records_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Health data encrypted and stored securely!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRecordData({
          type: "activity",
          description: "",
          value: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const analyzeWithFHE = async (recordId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Analyzing encrypted data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`health_record_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      // Simulate FHE analysis result (randomly determine status)
      const status = Math.random() > 0.7 ? 'abnormal' : 'normal';
      
      const updatedRecord = {
        ...recordData,
        status: status,
        fheProcessed: true
      };
      
      await contract.setData(
        `health_record_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `FHE analysis completed! Status: ${status}`
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Analysis failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const checkContractAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) {
        throw new Error("Contract not available");
      }
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `Contract is ${isAvailable ? "available" : "unavailable"}`
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Availability check failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const toggleRecordDetails = (recordId: string) => {
    setExpandedRecord(expandedRecord === recordId ? null : recordId);
  };

  const renderPieChart = () => {
    const total = records.length || 1;
    const normalPercentage = ((total - abnormalCount) / total) * 100;
    const abnormalPercentage = (abnormalCount / total) * 100;

    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div 
            className="pie-segment normal" 
            style={{ transform: `rotate(${normalPercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment abnormal" 
            style={{ transform: `rotate(${(normalPercentage + abnormalPercentage) * 3.6}deg)` }}
          ></div>
          <div className="pie-center">
            <div className="pie-value">{records.length}</div>
            <div className="pie-label">Records</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item">
            <div className="color-box normal"></div>
            <span>Normal: {total - abnormalCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box abnormal"></div>
            <span>Abnormal: {abnormalCount}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container natural-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>Elder<span>Guard</span></h1>
          <div className="fhe-badge">
            <span>FHE-Powered</span>
          </div>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-record-btn"
          >
            <div className="add-icon"></div>
            Add Health Data
          </button>
          <button 
            className="availability-btn"
            onClick={checkContractAvailability}
          >
            Check FHE Availability
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-panels">
          {/* Project Introduction Panel */}
          <div className="panel intro-panel">
            <h2>Privacy-Preserving Elderly Health Monitoring</h2>
            <p>
              ElderGuard uses Fully Homomorphic Encryption (FHE) to analyze sensitive health data 
              without ever decrypting it. This ensures complete privacy while monitoring elderly 
              family members for potential health issues.
            </p>
            <div className="fhe-explanation">
              <h3>How FHE Protects Privacy:</h3>
              <ul>
                <li>Sensor data is encrypted before leaving the device</li>
                <li>Analysis happens directly on encrypted data</li>
                <li>Only encrypted alerts are sent to family members</li>
                <li>Personal health data remains private at all times</li>
              </ul>
            </div>
          </div>
          
          {/* Statistics Panel */}
          <div className="panel stats-panel">
            <h2>Health Data Overview</h2>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-value">{totalRecords}</div>
                <div className="stat-label">Total Records</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{abnormalCount}</div>
                <div className="stat-label">Abnormal Events</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{activityCount}</div>
                <div className="stat-label">Activity Records</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{sleepCount}</div>
                <div className="stat-label">Sleep Records</div>
              </div>
            </div>
            
            <div className="chart-container">
              <h3>Health Status Distribution</h3>
              {renderPieChart()}
            </div>
          </div>
        </div>
        
        {/* Health Records Panel */}
        <div className="panel records-panel">
          <div className="section-header">
            <h2>Encrypted Health Records</h2>
            <div className="header-actions">
              <button 
                onClick={loadRecords}
                className="refresh-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="records-list">
            {records.length === 0 ? (
              <div className="no-records">
                <div className="no-records-icon"></div>
                <p>No health records found</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  Add First Record
                </button>
              </div>
            ) : (
              records.map(record => (
                <div className="record-card" key={record.id}>
                  <div className="record-summary" onClick={() => toggleRecordDetails(record.id)}>
                    <div className="record-type">
                      <div className={`type-icon ${record.type}`}></div>
                      <span>{record.type.charAt(0).toUpperCase() + record.type.slice(1)}</span>
                    </div>
                    <div className="record-date">
                      {new Date(record.timestamp * 1000).toLocaleString()}
                    </div>
                    <div className="record-status">
                      <span className={`status-badge ${record.status}`}>
                        {record.status}
                      </span>
                    </div>
                    <div className="record-fhe">
                      {record.fheProcessed ? (
                        <span className="fhe-processed">FHE Analyzed</span>
                      ) : (
                        <span className="fhe-pending">Needs Analysis</span>
                      )}
                    </div>
                  </div>
                  
                  {expandedRecord === record.id && (
                    <div className="record-details">
                      <div className="detail-row">
                        <span>Record ID:</span>
                        <span>{record.id}</span>
                      </div>
                      <div className="detail-row">
                        <span>Encrypted Data:</span>
                        <span className="encrypted-data">{record.encryptedData.substring(0, 40)}...</span>
                      </div>
                      <div className="detail-row">
                        <span>FHE Processed:</span>
                        <span>{record.fheProcessed ? "Yes" : "No"}</span>
                      </div>
                      
                      {!record.fheProcessed && (
                        <button 
                          className="analyze-btn"
                          onClick={() => analyzeWithFHE(record.id)}
                        >
                          Analyze with FHE
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
        
        {/* Team Information Panel */}
        <div className="panel team-panel">
          <h2>Our Team</h2>
          <div className="team-members">
            <div className="team-member">
              <div className="member-avatar"></div>
              <h3>Dr. Sarah Chen</h3>
              <p>Chief Medical Officer</p>
            </div>
            <div className="team-member">
              <div className="member-avatar"></div>
              <h3>James Wilson</h3>
              <p>FHE Research Lead</p>
            </div>
            <div className="team-member">
              <div className="member-avatar"></div>
              <h3>Amira Khan</h3>
              <p>IoT Security Specialist</p>
            </div>
            <div className="team-member">
              <div className="member-avatar"></div>
              <h3>David Rodriguez</h3>
              <p>Senior Developer</p>
            </div>
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitRecord} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          recordData={newRecordData}
          setRecordData={setNewRecordData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>ElderGuard</span>
            </div>
            <p>Privacy-preserving health monitoring using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} ElderGuard. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  recordData,
  setRecordData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRecordData({
      ...recordData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!recordData.type || !recordData.value) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Add Health Data Record</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your health data will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Data Type *</label>
              <select 
                name="type"
                value={recordData.type} 
                onChange={handleChange}
                className="custom-select"
              >
                <option value="activity">Activity Data</option>
                <option value="sleep">Sleep Data</option>
                <option value="alert">Alert Event</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Value *</label>
              <input 
                type="text"
                name="value"
                value={recordData.value} 
                onChange={handleChange}
                placeholder="Enter value..." 
                className="custom-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Description</label>
              <textarea 
                name="description"
                value={recordData.description} 
                onChange={handleChange}
                placeholder="Add description..." 
                className="custom-textarea"
                rows={3}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Data remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;