

# population - workforce

both supply and demand should have both workforce fresh and depleted. and better rename 'supply' to amount or value. if i understand properly all these arrays belongs to 'supply' is factual amount of items in cells, but 'demand' is just gradients for movement. this will be clear and understandable.

i expect population of settlement as color but map looks black or i dont see it good, probably settlement ico should not drawn on this view mode, but only population color.

on demand  tab:
fresh depleted - i am not sure it is proper work or proper colored. i expect big demand of fresh if factory and big demand of depleted in settlements. in case they are not full.

i think demand of depleted workforce should be proportional to settlement free space that is depends to map landscape as we told near water and meadow give biggest room for settlement.
improve this behavior.
this is how population migrate and some settlement growth.
think should we preserve population == workforce, or do some average. i think average is better so gradually if settlement dispatch more workforce then receive it loose population. less population - less send workforce on map.


all companies (factories, mines, towns) has slots for workers and some pool queue to store fresh workers who arrive after all places (worker slots or rest rooms) occupied. they wait to somebody left town to take a room. this make job shifts without gaps, smooth prices and transportation. because immediately fill gaps when workers depleted (tired) or become fresh and leave town




workers spawned by split into two when they have most needs met, enough food, and enough money.
Workers despawn after a long period without food.


# worker types possible to enable by checkboxes in game settings

## nomad default - both cells and particle engines
live in any town, tired nomad worker move by gradient (or if engine support - to best comfort town according to his money).
generate random nomad workers who prefer to save money from 0 up to 5 time visit until choose more rich towns. calculate and show what strategy is more profitable

## house owner - for particle engine, probably not possible in cell engine because not save worker identity.

this worker has his own house.
do not draw movement from job back home, save time home to fab and reuse it to return back
nomad can buy house in town. live in house pay 20% tax and have rest speed bonus. if no money to pay tax - sell house for full price.
house owner effect to town according their tax. make generalized calculation: 20% tax * 50 workers same as 10 nomads who pay 100% rent.

# food

particle worker buy food in town's bazaar
particle worker store some food - balance it as enough for walking 2..4 whole fresh time on map or work hard till tired (depleted fresh).
if cant buy - switch state to food search and move on map by gradient of food rich areas - water, forest - pick food, return to normal state

# market aka bazaar
bazaar build in town from start
keep food stock according to visitors, manage buy sell food price to be in profit and not rotten food to waste. 
particle workers buy food in bazaar according to their money to fill their bag.
bazaar can initiate food firm construction if prices too high and stock too low for a long.

# free workers 

if count of fresh workers without significant work demand gradient
in some cell  or area is big
then try to found firm for produce something with good price here and map source available

## free workers for particle engine

fresh workers without significant work demand gradient become free workers until tired. free workers move by gradient of some resources with biggest price/jobToGather and occasionally gather resources on map like food or wood. efficiency is lower then fabs. 
worker has paid once his product transported to buyer. probably this possible only for particle transportation engine. for cell engine as worker is not an object - we can think other approach or accept as is 

i dislike idea to deaths in badly supplied towns. better let workers move by map to slowly pick food themselves, call this special worker mode to not disturb by other tasks. this need another map with food gradient from rich-food location like water and forest. we can use low res, like 32x32 or update not every frame if this is costly.
in addition to this we can implement free food sources across map like monastery garden - work as farm but give free food for out of money. so it will work good with this gradient food source system.


# improve  resource conservation for town, other firms

bought resources , used to build something or make product or eaten.
efficiency is not 100%, partially  become wasteland and/or co2 on every stage