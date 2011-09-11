var sys = require('sys');
var bigint = require('bigint');
var events = require('events').EventEmitter;

var bitcoin = require('bitcoin-p2p');
var storage = new bitcoin.Storage('mongodb://localhost/bitcoin');
var node    = new bitcoin.Node();
var chain = node.getBlockChain();

global.Util = bitcoin.Util;

// Adds a list of outpoint addresses and values to a transaction
// Also adds transaction fee value (if any) and ouput values
// that have been converted back to normal numbers

Util.bigIntToBTC = function(bigInt) {
  return bigInt.div(Math.pow(10, 8)).toNumber();
};

function parseTxs(txs, callback) {
  if (txs.hash) txs = [txs];
  var referenceTxHashes = [];
  
  // Figure out all the transactions we need to find from the DB
  txs.forEach(function(tx){
    tx.ins.forEach(function(txInput){
      referenceTxHashes.push(txInput.outpoint.hash);
    });
  });
  
  // Find this transactions' inputs' outpoints
  // i.e., the previous transactions which the inputs reference
  storage.Transaction.find({hash: {"$in": referenceTxHashes}}, function(error, records){
    if (error) callback({error: error});
    
    // Index the referenced transactions by their hash
    var referenceTxs = [];
    records.forEach(function(record){
      referenceTxs[record.hash.toString('base64')] = record
    });
    
    // Go through each original transaction
    // (the transactions we're actually interested in)
    txs.forEach(function(tx, index){
      
      // Tack on some new properties
      tx.totalIn = bigint(0);
      tx.totalOut = bigint(0);
      tx.inputs = [];
      tx.outputs = [];
      tx.parsed = true;
      
      tx.getParsed = function(){
        return {
          hash: tx.hash,
          inputs: tx.inputs,
          outputs: tx.outputs,
        };
      };
      
      // Iterate through transaction inputs
      tx.ins.forEach(function(txInput){
        // Find this transaction's "source", or referenced transaction
        var hash = txInput.outpoint.hash.toString('base64');
        var sourceTx = referenceTxs[hash];
        var sourceOutAddress, sourceOutValue, sourceOutBtc;
        
        // Find the output the input is referencing
        if (sourceTx) {
          var sourceOut = sourceTx.outs[txInput.outpoint.index];
          
          if (sourceOut) {
            sourceOutAddress = sourceOut.script.toString('base64');
            sourceOutValue   = Util.valueToBigInt(sourceOut.value);
          
            // Readable value for those of us who don't understand BigInts
            sourceOutBtc = Util.bigIntToBTC(inputObj.value);
          }
        }
        
        var inputObj = {
          transactionHash: hash,
          transactionFound: !!sourceTx,
          index: txInput.outpoint.index,
          address: sourceOutAddress,
          value: sourceOutValue,
          btc:   sourceOutBtc
        };
        
        tx.inputs.push(inputObj);
        
        if (inputObj.value)
          tx.totalIn.add(inputObj.value); // Add to total value in
      });
      
      // Iterate through transaction outputs
      tx.outs.forEach(function(txOutput, index){
        // Add to total value out
        
        var outputObj = {
          address: txOutput.script.toString('base64'),
          index: index,
          value: Util.valueToBigInt(txOutput.value)
        };
        
        outputObj.btc = Util.bigIntToBTC(outputObj.value);
        
        tx.outputs.push(outputObj);
        
        // For some reason I have to convert to a number
        // or else the program breaks without an error
        var number = outputObj.value.toNumber();
        tx.totalOut = tx.totalOut.add(number);
      });
      
      // Determine transaction fee: output value - input value
      if (!tx.isCoinBase()) {
        tx.fee = tx.totalIn.sub(tx.totalOut);
        tx.btcfee = Util.bigIntToBTC(tx.fee);
      }
      
      // Update txs array
      txs[index] = tx;
    });
    
    return callback({txs: txs});
    
  });
}

node.start();

chain.on('txSave', function(e){
  parseTxs(e.tx, function(result){
    if (result.txs) {
      var tx = result.txs[0];
      console.log(tx.inputs);
      console.log(tx.outputs);
    }
  });
});
