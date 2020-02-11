import React, { useState } from 'react';
import './Scanner.css';

const Scanner = (props: any) => {
  const [scanText, setScanText] = useState("No Result");
  const zXing = new window.ZXing.BrowserQRCodeReader();

  zXing.getVideoInputDevices()
    .then((videoInputDevices: any) => {
        if (videoInputDevices) {
          zXing.decodeFromInputVideoDevice(videoInputDevices.label, 'videoTwo')
              .then((result: any) => {
                  if(result.text){
                    setScanText(result.text);
                    zXing.reset();
                  }

              }).catch((error: any) => {
                  console.error("Decode Error:", error)
              })
        }
    })
    .catch((err: any) => {
        console.error("Video Input Error: ", err)
    })
  return (
    <div className="scanner-container">
      <br />
      <video id="videoTwo" width="300" height="200" style={{border: "1px solid gray"}}></video>
      <br />
      <p className="scanner-results">{scanText}</p>
    </div>
  );
}

export default Scanner;