'use strict';

function inventoryLotAvailability(lot,location,today){
 const cartons=lot.sealed_cartons,loose=lot.loose_units,reserved=lot.reserved_units;
 if(![cartons,loose,reserved].every(value=>Number.isSafeInteger(value)&&value>=0)||reserved>loose)throw Error('Invalid stock or reservation count. Refresh and review this lot.');
 const freeLoose=loose-reserved,expired=!!lot.expiry_date&&lot.expiry_date<today;
 const dispatchable=lot.stock_status==='available'&&!expired&&location?.active===true&&location.is_dispatch_hub===true;
 const invoiceableLoose=dispatchable?freeLoose:0;
 const reason=!cartons&&!loose?'Out of stock':lot.stock_status!=='available'?'Quarantined':expired?'Expired':!location?.active?'Location inactive or unavailable':!location.is_dispatch_hub?'Transfer to dispatch hub':freeLoose?'Eligible for invoice reservation':cartons?'Open cartons before invoicing':'Fully reserved';
 return {cartons,loose,reserved,freeLoose,invoiceableLoose,reason,canOpenCartons:dispatchable&&cartons>0};
}
function inventoryStockTotals(lots,locations,today){
 const places=new Map(locations.map(location=>[location.id,location]));
 return lots.reduce((sum,lot)=>{
  const stock=inventoryLotAvailability(lot,places.get(lot.location_id),today);
  for(const key of Object.keys(sum))sum[key]+=stock[key];
  if(!Object.values(sum).every(Number.isSafeInteger))throw Error('Stock totals exceed the supported range.');
  return sum;
 },{cartons:0,loose:0,reserved:0,freeLoose:0,invoiceableLoose:0});
}

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
