if [ "$(id -u)" -eq 0 ]; then
  if [[ ! -e artifacts.csv ]]; then
    for i in $(seq 1 40)
      do
      echo "\033[0;31m请解压后再执行\033[0m"
    done
  else
  am start -n com.tencent.tmgp.supercell.boombeach/com.supercell.titan.tencent.GameAppTencentMidas
    sleep 2.5  
    FILE="/data/user/0/com.tencent.tmgp.supercell.boombeach/update/fingerprint.json"
    if [ ! -f "$FILE" ]; then
      for i in $(seq 1 40)
        do
        echo "\033[33m请先登录一次游戏再替换文件\033[0m"
      done
    else
      mkdir -p /data/user/0/com.tencent.tmgp.supercell.boombeach/update/csv
      cp *.csv /data/user/0/com.tencent.tmgp.supercell.boombeach/update/csv/
      chmod -R 777 /data/user/0/com.tencent.tmgp.supercell.boombeach/update
      am force-stop com.tencent.tmgp.supercell.boombeach
      for i in $(seq 1 40)
        do
        echo "\033[0;32m一键替换成功 ✓\033[0m"
      done
      sleep 1
      am start -n com.tencent.tmgp.supercell.boombeach/com.supercell.titan.tencent.GameAppTencentMidas
    fi       
  fi
else
    for i in $(seq 1 40)
      do
      echo "\033[0;35m无root权限，请检查mt管理器或模拟器是否有root\033[0m"
    done
fi