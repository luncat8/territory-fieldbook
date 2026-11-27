
gold mine - this is only source of gold to economy: workers wages of gold miners. and resources that mine bought to function or construction (wood).

next 'gold mine' is for example, most things are similar to other firms.
gold mine - pay for resources and work
after got enough money then possible to reinvest or return debts to bank
deferred: 
- spend on larger mine ~ workers max
- buy upgraded machines from factory ~ increase speed ~ fuel usage
- buy better knowledge from sci academy ~ increase efficiency ~ fuel usage, less ore become to wasteland, more become to gold
- buy new empty mine-sites locations from players, who explored them on the map. use dialog to propose dial : letter ico near mine on map. update proposition over time, according to mice company money and expected profit from new mine (is enough workers and good price, is existing mines profitable).



## owners of facilities
game settings: 
- each firm has new owner with money purse
- owners are not belong to one fab, but can own any number with shared money

## bank

instead of spawn with gold - firms got gold or paper money from banks.
bank can emit paper money if has issues with gold or for better profit
bank buy gold - and set some paper price ratio for it according to demand and profit
bank manage credits, debts, loan, for some % per time, abd adjust % to keep demand of bank's service and be in profit

our decision - paper money may be emitted by bank - separate firm that may be independent or controlled by each player's fraction; each banks may emit their own money or use existing or only gold.

before we implement paper money, there is no possibility to buy gold. so it should not placed on map as item because nobody can pay for it without paper money.
because paper money depends on storyline or tech-tree these should be checkbox to enable it (save sate).

- how paper money goes into economy
- who initially demand on it to replace insufficient gold amount
- who will accept money and for what exchange price
concurrency of different money, stability and exchange rate to gold


open generalized question : should output of firms placed on map if zero gradient or keep in internal depot? probably internal depot good - we can easy count is any fab has it before for example construct some consumer.



deferred: to move money, owners and banks use transport object that moving to target buy roads graph, or by line unless roads implemented.





there suggestions by llm looks out of design of cell and particle engines:

>>Financing: owner capital → existing-gold bank loans → backed notes → credit notes.

i dont recommend emit paper money from same gold amount. this is miss-concept of real economy and not worth to put it in game. if have gold - pay with gold. if want credit money more then gold exist - emit them if anyone want to accept it in exchange for real goods.

>>Output: internal depot versus speculative map particles; reserved buyer-directed dispatch later.

we dont have directed dispatch : cell and   particle transport engine  dont support such by design.

---- answers:


Starting gold: i recommend not hardcoded but get amount from reasonable daily amount to not have start transient issues. i.e. 1 gold per worker.

Shared owners: all owned facilities share both cash and debt.


use internal storage for factory output for products that appears internally like A+B=Out or A+work=Out. till demand price gradient appears. if nobody ask - we can even skip transportation calculation to save CPU for products that not yet have any demand.
! important: this is about items amount. the prices demand field always should be emitted and faded to provide price gradients over map and be able to predict cost in any position with simple cells interpolations.

also
place on map harvested resources like forest -> logs at their cutting location.

good feature worth to test (deferred): some products better stored in depot then on map, like food, so factory can keep them until good price.


credit-note defaults/runs intended
- allow some debt amount limit per firm.
if factory negative - firm may sell it to bank.
if firm cant pay workers and cant get more money or sold last facility - firm closed, all factories become ownership by bank, bank sell them.

this lead us to important to have owners same as workers - any worker with money can buy or found firm. no money - we spawned firms like sawmill just by select random free worker from that free workforce around, who need to spawn new fab where free workers and resources exist without some paid initiation. as drafts said.

saving settings - for prototypes saving interface is enough. for game - we will also implement whole save later.


Suggested first implementation of scenario to test whole system:
place gold site
place free workers
place some towns and other facilities
free workers → firm owner + gold mine
(gold mine can pay with gold itself) and set job demand gradient to hire workers
free workers movement to gold mine by job demand gradient

place forest
place free workers
free workers → firm owner + sawmill
sawmill owner get money from bank to be able pay workers
...
bank-loan repayment

