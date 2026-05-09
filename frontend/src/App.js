import ChatBox from "./components/ChatBox";
import Dashboard from "./components/Dashboard";
import "./styles.css";

function App() {
  return (
    <div className="app">
      <div className="left">
        <Dashboard />
      </div>

      <div className="right">
        <ChatBox />
      </div>
    </div>
  );
}

export default App;