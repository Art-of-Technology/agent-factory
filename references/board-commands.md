# GitHub Project Board Commands

## Project IDs (ProblemRadar)
- Project ID: `PVT_kwDOBh3QCc4BQfmw`
- Project Number: `20`
- Status Field ID: `PVTSSF_lADOBh3QCc4BQfmwzg-mKZE`
- Status Options: Todo=`f75ad846`, In Progress=`47fc9ee4`, Done=`98236657`
- Agent Field ID: `PVTSSF_lADOBh3QCc4BQfmwzg-mT6A`

## Move issue to "In Progress"
```bash
# 1. Get item ID
ITEM_ID=$(gh project item-list 20 --owner Art-of-Technology --format json --limit 50 | node -e "process.stdin.on('data',d=>{const items=JSON.parse(d).items;const item=items.find(i=>i.content.number===ISSUE_NUM);if(item)console.log(item.id)})")

# 2. Update status
gh project item-edit --project-id PVT_kwDOBh3QCc4BQfmw --id $ITEM_ID --field-id PVTSSF_lADOBh3QCc4BQfmwzg-mKZE --single-select-option-id 47fc9ee4
```

## Move issue to "Done"
```bash
gh project item-edit --project-id PVT_kwDOBh3QCc4BQfmw --id $ITEM_ID --field-id PVTSSF_lADOBh3QCc4BQfmwzg-mKZE --single-select-option-id 98236657
```
