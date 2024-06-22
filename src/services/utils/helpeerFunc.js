export function filterUsersByRole (arr, role){
    let filteredArr = arr.filter(user => user.role === role);
    return filteredArr;
}