'use strict';

function inventoryInteger(value,label){
 if(!Number.isSafeInteger(value)||value<0)throw Error(`${label} must be a whole number.`);
 return value;
}
function positiveInventoryInteger(value,label){
 inventoryInteger(value,label);
 if(value<1)throw Error(`${label} must be at least one.`);
 return value;
}
function planCartonTransfer({cartons,unitsPerCarton,availableCartons}){
 if(!Number.isSafeInteger(cartons))throw Error('Enter whole cartons.');
 positiveInventoryInteger(cartons,'Transfer cartons');
 positiveInventoryInteger(unitsPerCarton,'Units per carton');
 inventoryInteger(availableCartons,'Available cartons');
 if(cartons>availableCartons)throw Error(`Only ${availableCartons} sealed cartons are available.`);
 const baseUnits=cartons*unitsPerCarton;
 if(!Number.isSafeInteger(baseUnits))throw Error('Transfer quantity is too large.');
 return {cartons,baseUnits};
}
function planBreakPack({location,cartons,unitsPerCarton,availableCartons,looseUnits}){
 if(!location?.isDispatchHub)throw Error('Cartons may only be opened at the configured dispatch hub.');
 const transfer=planCartonTransfer({cartons,unitsPerCarton,availableCartons});
 inventoryInteger(looseUnits,'Loose units');
 const resultingLooseUnits=looseUnits+transfer.baseUnits;
 if(!Number.isSafeInteger(resultingLooseUnits))throw Error('Loose-unit balance is too large.');
 return {sealedCartonChange:-cartons,looseUnitChange:transfer.baseUnits,remainingCartons:availableCartons-cartons,resultingLooseUnits,totalBaseUnitChange:0};
}
function receiptOutcome({expectedUnits,actualUnits,inspection}){
 positiveInventoryInteger(expectedUnits,'Expected units');
 inventoryInteger(actualUnits,'Counted units');
 return inspection==='pass'&&actualUnits===expectedUnits?'received':'quarantine';
}
function stockPosition({sealedCartons,looseUnits,unitsPerCarton,reservedUnits=0}){
 inventoryInteger(sealedCartons,'Sealed cartons');
 inventoryInteger(looseUnits,'Loose units');
 positiveInventoryInteger(unitsPerCarton,'Units per carton');
 inventoryInteger(reservedUnits,'Reserved units');
 const totalBaseUnits=sealedCartons*unitsPerCarton+looseUnits;
 if(!Number.isSafeInteger(totalBaseUnits))throw Error('Stock balance is too large.');
 if(reservedUnits>totalBaseUnits)throw Error('Reserved units cannot exceed stock on hand.');
 return {totalBaseUnits,availableBaseUnits:totalBaseUnits-reservedUnits};
}
