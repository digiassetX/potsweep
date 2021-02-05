# PotSweep

## Installation
``` bash
npm install potsweep
```

## Safe Usage
``` javascript
const PotSweep=require('potsweep');

const getRawTxs=async(mnemonic,coinAddress)=>{
    let addressData=await DigiSweep.findFunds(mnemonic);
    if (addressData.length===0) {
        return["Mnemonic was never used"];
    }
    return DigiSweep.buildTXs(addressData,coinAddress);
}

getRawTxs('acoustic maximum page wife amount praise guess unhappy argue rather fat minor ordinary talent distance toast earth miss fiscal shell device sure version kangaroo','PWDLuGt7dRPaAE6QQBYQmAtQBPxpghzzVN').then((commands)=>{
    console.log("Execute the following commands on a core wallet");
    console.log(commands);
    console.log("Copy the returned hex value from each command and execute")
    console.log("sendrawtransaction hexvalue");
});
```

## Unsafe But Easy
``` javascript
const DigiSweep=require('potsweep');

const sendRawTxs=async(mnemonic,coinAddress)=>{
    let addressData=await DigiSweep.findFunds(mnemonic);
    if (addressData.length===0) {
        return["Mnemonic was never used"];
    }
    return DigiSweep.sendTXs(addressData,coinAddress);
}

sendRawTxs('acoustic maximum page wife amount praise guess unhappy argue rather fat minor ordinary talent distance toast earth miss fiscal shell device sure version kangaroo','PWDLuGt7dRPaAE6QQBYQmAtQBPxpghzzVN').then((txids)=>{
    console.log("Transaction was sent with the following txids");
    console.log(txids);
});
```